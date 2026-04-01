#!/usr/bin/env python3
"""
naming-convention-audit: 按模型指定的规则扫描文件/文件夹命名违规。

本脚本不做框架检测，所有决策由调用方（模型）通过 JSON 配置传入。
脚本只负责：遍历目录 → 按规则匹配 → 输出 JSON 报告。

用法:
    echo '<config_json>' | python audit_naming.py
    python audit_naming.py config.json

配置 JSON 格式:
{
  "scans": [
    {
      "root": "apps/backend/src",
      "framework": "nestjs",
      "extra_skip_dirs": ["generated"],
      "extra_ok_files": ["bootstrap.ts"]
    },
    {
      "root": "apps/front/src",
      "framework": "nextjs-react",
      "app_dir": "app",
      "extra_skip_dirs": [],
      "extra_ok_files": []
    },
    {
      "root": "apps/admin-front/src",
      "framework": "react",
      "extra_skip_dirs": [],
      "extra_ok_files": []
    }
  ]
}

支持的 framework 值:
  - nestjs          : NestJS 后端（kebab-name.type.ts）
  - nextjs-react    : Next.js + React（PascalCase .tsx, kebab .ts, 路由文件豁免）
  - react           : React SPA / Vite（PascalCase .tsx, kebab .ts）
  - vue             : Vue（kebab-case .vue, kebab .ts）
  - angular         : Angular（kebab-name.type.ts，类似 NestJS）
  - generic-ts      : 通用 TypeScript（全 kebab-case）
"""
from __future__ import annotations

import json
import os
import re
import sys
from dataclasses import asdict, dataclass
from pathlib import Path

# ── 默认跳过 ──────────────────────────────────────────────

DEFAULT_SKIP_DIRS = frozenset({
    'node_modules', '.git', 'dist', 'build', '.next', '.nuxt', '.output',
    '.turbo', '.nx', 'coverage', '.cache', '__pycache__', '.omc', '.claude',
    '.vscode', '.idea', 'generated', 'migrations',
})

DEFAULT_SKIP_FILES = frozenset({'.DS_Store', 'thumbs.db', '.gitkeep'})

DEFAULT_OK_FILES = frozenset({
    'index.ts', 'index.tsx', 'index.js', 'index.jsx',
    'main.ts', 'main.tsx', 'main.js', 'main.jsx',
    'types.ts', 'types.d.ts', 'constants.ts',
    'seed.ts', 'schema.prisma', 'App.tsx', 'App.ts',
})

# ── NestJS 类型后缀（最长优先） ──────────────────────────────

NESTJS_COMPOUND_SUFFIXES = [
    '.e2e-spec.ts', '.response.dto.ts', '.request.dto.ts',
    '.exception.spec.ts', '.service.spec.ts', '.controller.spec.ts',
    '.repository.spec.ts', '.guard.spec.ts',
]
NESTJS_SIMPLE_SUFFIXES = [
    '.controller.ts', '.repository.ts', '.interceptor.ts', '.middleware.ts',
    '.subscriber.ts', '.decorator.ts', '.interface.ts', '.exception.ts',
    '.constants.ts', '.constant.ts', '.strategy.ts', '.provider.ts',
    '.adapter.ts', '.factory.ts', '.service.ts', '.module.ts',
    '.helper.ts', '.entity.ts', '.guard.ts', '.pipe.ts',
    '.filter.ts', '.enum.ts', '.util.ts', '.config.ts',
    '.spec.ts', '.type.ts', '.types.ts', '.dto.ts',
]
NESTJS_ALL_SUFFIXES = NESTJS_COMPOUND_SUFFIXES + NESTJS_SIMPLE_SUFFIXES

# Next.js 路由文件
NEXTJS_ROUTE_FILES = frozenset({
    'page.tsx', 'page.ts', 'page.jsx', 'page.js',
    'layout.tsx', 'layout.ts', 'layout.jsx', 'layout.js',
    'loading.tsx', 'loading.ts', 'error.tsx', 'error.ts',
    'not-found.tsx', 'not-found.ts', 'template.tsx', 'template.ts',
    'default.tsx', 'default.ts', 'route.tsx', 'route.ts',
    'middleware.ts', 'middleware.js', 'global-error.tsx',
    'sitemap.ts', 'robots.ts', 'opengraph-image.tsx', 'icon.tsx',
    'apple-icon.tsx', 'manifest.ts',
})

# 前端 .ts 文件的合法 type 后缀
FRONTEND_TYPE_SUFFIXES = frozenset({
    'helpers', 'helper', 'utils', 'util', 'config', 'storage',
    'context', 'types', 'schema', 'styles', 'constants',
    'mock', 'mocks', 'fixture', 'fixtures', 'service',
})

# Angular 类型后缀
ANGULAR_SUFFIXES = [
    '.component.spec.ts', '.service.spec.ts', '.pipe.spec.ts',
    '.directive.spec.ts', '.guard.spec.ts', '.resolver.spec.ts',
    '.component.ts', '.component.html', '.component.css', '.component.scss',
    '.service.ts', '.module.ts', '.pipe.ts', '.directive.ts',
    '.guard.ts', '.resolver.ts', '.interceptor.ts', '.model.ts',
    '.interface.ts', '.enum.ts', '.spec.ts',
]


# ── 数据结构 ──────────────────────────────────────────────

@dataclass
class Violation:
    path: str
    kind: str           # file | directory
    rule: str
    message: str
    current: str
    suggested: str | None
    severity: str       # info | warning


# ── 判断工具 ──────────────────────────────────────────────

def is_kebab(name: str) -> bool:
    return bool(re.match(r'^[a-z][a-z0-9]*(-[a-z0-9]+)*$', name))

def is_pascal(name: str) -> bool:
    return bool(re.match(r'^[A-Z][a-zA-Z0-9]+$', name))

def is_camel(name: str) -> bool:
    return bool(re.match(r'^[a-z][a-zA-Z0-9]+$', name))

def to_kebab(name: str) -> str:
    s = re.sub(r'([A-Z])', r'-\1', name).lower().lstrip('-')
    s = s.replace('.', '-').replace('_', '-')
    return re.sub(r'-+', '-', s)

def to_pascal(name: str) -> str:
    parts = re.split(r'[-_.]', name)
    return ''.join(p.capitalize() for p in parts if p)


# ── NestJS 检查 ───────────────────────────────────────────

def _extract_suffix(filename: str, suffixes: list[str]) -> tuple[str, str | None]:
    for suffix in suffixes:
        if filename.endswith(suffix):
            return filename[:-len(suffix)], suffix
    base = filename.rsplit('.', 1)[0] if '.' in filename else filename
    return base, None


def check_nestjs_file(fn: str, rel: str, ok_files: frozenset) -> list[Violation]:
    vs: list[Violation] = []
    if not fn.endswith('.ts') or fn.endswith('.d.ts') or fn in ok_files:
        return vs
    name, suffix = _extract_suffix(fn, NESTJS_ALL_SUFFIXES)
    if suffix:
        if name and '.' in name:
            vs.append(Violation(
                path=rel, kind='file', rule='nestjs-name-dots',
                message='name 部分应使用 kebab-case（连字符），不应使用点号',
                current=fn, suggested=name.replace('.', '-') + suffix, severity='warning'))
        elif name and not is_kebab(name) and name not in ('', 'i18n'):
            vs.append(Violation(
                path=rel, kind='file', rule='nestjs-name-case',
                message='name 部分应使用 kebab-case',
                current=fn, suggested=to_kebab(name) + suffix, severity='warning'))
    else:
        if name and '.' in name:
            vs.append(Violation(
                path=rel, kind='file', rule='nestjs-name-dots',
                message='文件名包含多余的点号',
                current=fn, suggested=name.replace('.', '-') + '.ts', severity='info'))
    return vs


def check_nestjs_dir(dn: str, rel: str) -> list[Violation]:
    vs: list[Violation] = []
    if '.' in dn:
        vs.append(Violation(
            path=rel, kind='directory', rule='nestjs-dir-dots',
            message='目录名不应包含点号，应使用 kebab-case',
            current=dn, suggested=dn.replace('.', '-'), severity='warning'))
    elif not is_kebab(dn) and dn not in ('dto', 'e2e', 'src'):
        vs.append(Violation(
            path=rel, kind='directory', rule='nestjs-dir-case',
            message='目录名应使用 kebab-case',
            current=dn, suggested=to_kebab(dn), severity='warning'))
    return vs


# ── Angular 检查 ──────────────────────────────────────────

def check_angular_file(fn: str, rel: str, ok_files: frozenset) -> list[Violation]:
    vs: list[Violation] = []
    if fn in ok_files:
        return vs
    name, suffix = _extract_suffix(fn, ANGULAR_SUFFIXES)
    if suffix:
        if name and '.' in name:
            vs.append(Violation(
                path=rel, kind='file', rule='angular-name-dots',
                message='name 部分应使用 kebab-case',
                current=fn, suggested=name.replace('.', '-') + suffix, severity='warning'))
        elif name and not is_kebab(name):
            vs.append(Violation(
                path=rel, kind='file', rule='angular-name-case',
                message='name 部分应使用 kebab-case',
                current=fn, suggested=to_kebab(name) + suffix, severity='warning'))
    return vs


# ── React / Next.js 检查 ─────────────────────────────────

def check_tsx_file(fn: str, rel: str, ok_files: frozenset,
                   is_app_dir: bool, has_nextjs: bool) -> list[Violation]:
    vs: list[Violation] = []
    if not fn.endswith('.tsx') or fn in ok_files:
        return vs
    base = fn[:-4]
    if base == 'index':
        return vs
    if has_nextjs and is_app_dir and fn in NEXTJS_ROUTE_FILES:
        return vs
    if base.startswith('['):
        return vs
    if base.endswith('.test') or base.endswith('.spec'):
        return vs
    if not is_pascal(base):
        vs.append(Violation(
            path=rel, kind='file', rule='react-tsx-pascal',
            message='.tsx 组件文件应使用 PascalCase',
            current=fn, suggested=to_pascal(base) + '.tsx', severity='warning'))
    return vs


def check_ts_file(fn: str, rel: str, ok_files: frozenset) -> list[Violation]:
    vs: list[Violation] = []
    if not fn.endswith('.ts') or fn.endswith('.d.ts') or fn in ok_files:
        return vs
    base = fn[:-3]
    # hook → camelCase
    if base.startswith('use') and len(base) > 3 and base[3:4].isupper():
        if not is_camel(base):
            vs.append(Violation(
                path=rel, kind='file', rule='react-hook-camel',
                message='Hook 文件应使用 camelCase（useXxx.ts）',
                current=fn, suggested=None, severity='warning'))
        return vs
    clean = re.sub(r'\.(spec|test)$', '', base)
    parts = clean.rsplit('.', 1)
    if len(parts) == 2 and parts[1] in FRONTEND_TYPE_SUFFIXES:
        name_part = parts[0]
        if name_part and not is_kebab(name_part):
            tail = base[len(clean):]
            vs.append(Violation(
                path=rel, kind='file', rule='react-ts-kebab',
                message='.ts 文件 name 部分应使用 kebab-case',
                current=fn, suggested=to_kebab(name_part) + '.' + parts[1] + tail + '.ts',
                severity='warning'))
    elif clean and not is_kebab(clean):
        tail = base[len(clean):]
        vs.append(Violation(
            path=rel, kind='file', rule='react-ts-kebab',
            message='.ts 非组件文件应使用 kebab-case',
            current=fn, suggested=to_kebab(clean) + tail + '.ts', severity='warning'))
    return vs


def check_vue_file(fn: str, rel: str, ok_files: frozenset) -> list[Violation]:
    vs: list[Violation] = []
    if not fn.endswith('.vue') or fn in ok_files:
        return vs
    base = fn[:-4]
    # Vue 组件可以是 PascalCase 或 kebab-case，但不能混用其他格式
    if not is_pascal(base) and not is_kebab(base):
        vs.append(Violation(
            path=rel, kind='file', rule='vue-component-case',
            message='.vue 组件应使用 PascalCase 或 kebab-case',
            current=fn, suggested=to_pascal(base) + '.vue', severity='warning'))
    return vs


def check_frontend_dir(dn: str, rel: str) -> list[Violation]:
    vs: list[Violation] = []
    if dn[0:1] in ('[', '(', '@', '_'):
        return vs
    if dn in ('ui', 'e2e', 'app', 'src', 'public', 'pages', 'assets', 'static'):
        return vs
    if not is_kebab(dn):
        vs.append(Violation(
            path=rel, kind='directory', rule='frontend-dir-kebab',
            message='目录应使用 kebab-case',
            current=dn, suggested=to_kebab(dn), severity='warning'))
    if dn.endswith('s') and not dn.endswith('ss') and len(dn) > 3:
        parent_name = Path(rel).parent.name
        if parent_name == 'components':
            vs.append(Violation(
                path=rel, kind='directory', rule='frontend-dir-singular',
                message='components/ 下子目录建议使用单数',
                current=dn, suggested=dn[:-1], severity='info'))
    return vs


def check_generic_ts(fn: str, rel: str, ok_files: frozenset) -> list[Violation]:
    vs: list[Violation] = []
    if fn in ok_files or fn.endswith('.d.ts'):
        return vs
    if fn.endswith('.ts') or fn.endswith('.tsx') or fn.endswith('.js') or fn.endswith('.jsx'):
        base = fn.rsplit('.', 1)[0]
        if not is_kebab(base) and base != 'index':
            vs.append(Violation(
                path=rel, kind='file', rule='generic-ts-kebab',
                message='文件名应使用 kebab-case',
                current=fn, suggested=to_kebab(base) + '.' + fn.rsplit('.', 1)[1],
                severity='warning'))
    return vs


# ── 扫描引擎 ─────────────────────────────────────────────

def scan(config: dict) -> dict:
    """按配置扫描，返回结果字典。"""
    project_root = Path.cwd().resolve()
    all_violations: list[Violation] = []

    for scan_cfg in config.get('scans', []):
        root_rel = scan_cfg['root']
        framework = scan_cfg.get('framework', 'generic-ts')
        extra_skip = frozenset(scan_cfg.get('extra_skip_dirs', []))
        extra_ok = frozenset(scan_cfg.get('extra_ok_files', []))
        app_dir_name = scan_cfg.get('app_dir', 'app')

        skip_dirs = DEFAULT_SKIP_DIRS | extra_skip
        ok_files = DEFAULT_OK_FILES | extra_ok | DEFAULT_SKIP_FILES

        scan_root = project_root / root_rel
        if not scan_root.exists():
            continue

        app_dir_path = scan_root / app_dir_name
        has_nextjs = framework == 'nextjs-react'

        for root, dirs, files in os.walk(scan_root):
            rp = Path(root)
            dirs[:] = sorted(d for d in dirs if d not in skip_dirs)

            # 检查目录名
            if rp != scan_root:
                dn = rp.name
                rel = str(rp.relative_to(project_root))
                if framework in ('nestjs', 'angular'):
                    all_violations.extend(check_nestjs_dir(dn, rel))
                elif framework in ('nextjs-react', 'react', 'vue'):
                    all_violations.extend(check_frontend_dir(dn, rel))

            # 检查文件名
            for f in sorted(files):
                if f in DEFAULT_SKIP_FILES:
                    continue
                fp = rp / f
                rel = str(fp.relative_to(project_root))
                in_app = has_nextjs and str(rp).startswith(str(app_dir_path))

                if framework == 'nestjs':
                    all_violations.extend(check_nestjs_file(f, rel, ok_files))
                elif framework == 'angular':
                    all_violations.extend(check_angular_file(f, rel, ok_files))
                elif framework in ('nextjs-react', 'react'):
                    if f.endswith('.tsx'):
                        all_violations.extend(
                            check_tsx_file(f, rel, ok_files, in_app, has_nextjs))
                    elif f.endswith('.ts'):
                        all_violations.extend(check_ts_file(f, rel, ok_files))
                elif framework == 'vue':
                    if f.endswith('.vue'):
                        all_violations.extend(check_vue_file(f, rel, ok_files))
                    elif f.endswith('.ts'):
                        all_violations.extend(check_ts_file(f, rel, ok_files))
                elif framework == 'generic-ts':
                    all_violations.extend(check_generic_ts(f, rel, ok_files))

    # 只保留 warning
    filtered = [v for v in all_violations if v.severity == 'warning']

    by_rule: dict[str, int] = {}
    for v in filtered:
        by_rule[v.rule] = by_rule.get(v.rule, 0) + 1

    # 修复计划
    fix_plan: list[dict] = []
    for v in filtered:
        if not v.suggested:
            continue
        if v.kind == 'file':
            old = v.path
            new = str(Path(v.path).parent / v.suggested)
            fix_plan.append({'old': old, 'new': new,
                             'git_mv': f'git mv "{old}" "{new}"'})
        elif v.kind == 'directory':
            old = v.path
            parent = v.path.rsplit('/', 1)[0] if '/' in v.path else '.'
            new = parent + '/' + v.suggested
            fix_plan.append({'old': old, 'new': new,
                             'note': '目录重命名需同步更新所有导入路径'})

    return {
        'total_violations': len(filtered),
        'summary_by_rule': by_rule,
        'violations': [asdict(v) for v in filtered],
        'fix_plan': fix_plan,
    }


def main() -> None:
    # 从 stdin 或文件参数读取配置
    if len(sys.argv) > 1 and sys.argv[1] != '-':
        config_text = Path(sys.argv[1]).read_text()
    else:
        config_text = sys.stdin.read()

    config = json.loads(config_text)
    result = scan(config)
    json.dump(result, sys.stdout, indent=2, ensure_ascii=False)
    print()
    sys.exit(1 if result['total_violations'] > 0 else 0)


if __name__ == '__main__':
    main()
