export function createRemotePhaseModel(payload) {
  return [
    { phase: 'lock', payload },
    { phase: 'extract', payload },
    { phase: 'env', payload },
    { phase: 'install', payload },
    { phase: 'prisma-generate', payload },
    { phase: 'prisma-migrate', payload },
    { phase: 'switch-current', payload },
    { phase: 'startup', payload },
    { phase: 'cleanup', payload },
  ]
}
