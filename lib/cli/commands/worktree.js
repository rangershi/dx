import { logger } from '../../logger.js'
import { confirmManager } from '../../confirm.js'

export async function handleWorktree(cli, args) {
  const worktreeManager = await cli.getWorktreeManager()
  logger.warn('注意：该封装与原生 git worktree 行为不同，勿混用')
  const action = args[0]
  const issueNumber = args[1]
  // 解析可选的基础分支（位置参数或 --base/-b 标志）
  let baseBranch = null
  // 位置参数作为第3个无标志参数传入
  if (args[2] && !String(args[2]).startsWith('-')) {
    baseBranch = args[2]
  }
  // 支持 --base/-b 标志（从原始参数中解析，包含所有标志）
  const allArgs = cli.args
  const baseIdx = allArgs.indexOf('--base')
  const shortBaseIdx = allArgs.indexOf('-b')
  if (!baseBranch) {
    if (baseIdx !== -1 && baseIdx + 1 < allArgs.length) baseBranch = allArgs[baseIdx + 1]
    else if (shortBaseIdx !== -1 && shortBaseIdx + 1 < allArgs.length) baseBranch = allArgs[shortBaseIdx + 1]
  }

  if (!action) {
    logger.error('请指定 worktree 操作: make, del, list, clean')
    logger.info('用法:')
    logger.info('  dx worktree make <issue_number> [base]  - 创建新的 worktree（可选基础分支）')
    logger.info('  dx worktree del <issue_number> [issue_number2] ...  - 删除指定 worktree（支持批量）')
    logger.info('  dx worktree del --all            - 删除所有 issue 相关 worktree')
    logger.info('  dx worktree list                 - 列出所有 worktree')
    logger.info('  dx worktree clean                - 清理无效的 worktree')
    logger.info('')
    logger.info('选项:')
    logger.info('  --base <branch>, -b <branch>     - 指定基础分支（make 命令专用）')
    logger.info('  --all                            - 删除所有 worktree（del 命令专用）')
    logger.info('  -Y, --yes                        - 跳过所有确认提示（非交互式）')
    logger.info('')
    logger.info('示例:')
    logger.info('  dx worktree make 88              - 从 main 分支创建 worktree')
    logger.info('  dx worktree make 88 dev          - 从 dev 分支创建 worktree')
    logger.info('  dx worktree make 88 --base dev   - 使用标志指定基础分支')
    logger.info('  dx worktree del 88               - 删除单个 worktree')
    logger.info('  dx worktree del 88 89 90         - 批量删除多个 worktree')
    logger.info('  dx worktree del --all            - 删除所有 worktree（需确认）')
    logger.info('  dx worktree del --all -Y         - 删除所有（跳过确认）')
    logger.warn('注意：该封装与原生 git worktree 行为不同，勿混用')
    process.exitCode = 1
    return
  }

  switch (action) {
    case 'make':
      if (!issueNumber) {
        logger.error('请指定 issue 编号')
        logger.info('用法: dx worktree make <issue_number> [base]  或  dx worktree make <issue_number> --base <branch>')
        logger.info('示例: dx worktree make 88 dev  或  dx worktree make 88 --base dev')
        process.exitCode = 1
        return
      }
      await worktreeManager.make(issueNumber, {
        force: Boolean(cli.flags.Y),
        baseBranch,
      })
      break

    case 'del':
    case 'delete':
    case 'rm':
      // 互斥校验：--all 不能与 issue 编号同时使用
      // args[0] 是 action，args[1] 开始才是 issue 编号
      if (cli.flags.all && args.length > 1) {
        logger.error('--all 标志不能与 issue 编号同时使用')
        logger.info('用法: dx worktree del --all  或  dx worktree del <issue_number> ...')
        process.exitCode = 1
        return
      }

      // 批量删除所有 worktree
      if (cli.flags.all) {
        const allIssues = await worktreeManager.getAllIssueWorktrees()

        if (allIssues.length === 0) {
          logger.info('没有找到 issue 相关的 worktree')
          return
        }

        logger.info(`\n找到 ${allIssues.length} 个 issue worktree:`)
        allIssues.forEach(issue => {
          logger.info(`  - issue-${issue}`)
        })

        // 安全确认（除非 -Y）
        if (!cli.flags.Y) {
          const confirmed = await confirmManager.confirm(
            `\n确定要删除所有 ${allIssues.length} 个 worktree 吗？(这将永久删除工作目录)`,
            false,
            false,
          )
          if (!confirmed) {
            logger.info('操作已取消')
            return
          }
        }

        await worktreeManager.del(allIssues, { force: Boolean(cli.flags.Y) })
        return
      }

      // 删除指定 issue 编号（原逻辑保持不变）
      if (!issueNumber) {
        logger.error('请指定一个或多个 issue 编号，或使用 --all 删除所有')
        logger.info('用法: dx worktree del <issue_number> [issue_number2] ...')
        logger.info('      dx worktree del --all  # 删除所有 issue 相关 worktree')
        logger.info('示例: dx worktree del 123 456 789  # 批量删除指定 worktree')
        logger.info('      dx worktree del --all -Y      # 删除所有（跳过确认）')
        logger.info('选项: -Y, --yes  # 跳过所有确认提示')
        process.exitCode = 1
        return
      }

      // 收集所有 issue 编号（从第二个参数开始的所有非标志参数）
      const issueNumbers = [issueNumber]
      for (let i = 2; i < args.length; i++) {
        const arg = args[i]
        if (arg && !arg.startsWith('-')) {
          issueNumbers.push(arg)
        }
      }

      await worktreeManager.del(issueNumbers, { force: Boolean(cli.flags.Y) })
      break

    case 'list':
    case 'ls':
      await worktreeManager.list()
      break

    case 'clean':
    case 'prune':
      await worktreeManager.clean()
      break

    default:
      logger.error(`未知的 worktree 操作: ${action}`)
      logger.info('可用操作: make, del, list, clean')
      logger.info('使用 dx worktree --help 查看详细用法')
      logger.warn('注意：该封装与原生 git worktree 行为不同，勿混用')
  }
}
