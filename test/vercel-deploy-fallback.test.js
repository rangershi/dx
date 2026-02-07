import { jest } from '@jest/globals'
import { deployPrebuiltWithFallback } from '../lib/vercel-deploy.js'

describe('deployPrebuiltWithFallback()', () => {
  test('runs once when first deploy succeeds', async () => {
    const run = jest.fn().mockResolvedValue({ code: 0 })
    const baseArgs = ['deploy', '--prebuilt', '--local-config', '/tmp/vercel.json', '--yes']

    const result = await deployPrebuiltWithFallback({
      baseArgs,
      env: { TEST: '1' },
      cwd: '/tmp',
      run,
      cleanupArchiveParts: jest.fn(),
      onMissingFiles: jest.fn(),
    })

    expect(result).toEqual({ usedArchive: false })
    expect(run).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledWith(baseArgs, { env: { TEST: '1' }, cwd: '/tmp' })
  })

  test('retries once with --archive=tgz when missing_files detected', async () => {
    const err = new Error('failed')
    err.stderr = '400 {"error":{"code":"missing_files"}}'

    const run = jest
      .fn()
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce({ code: 0 })

    const baseArgs = ['deploy', '--prebuilt', '--local-config', '/tmp/vercel.json', '--yes']
    const onMissingFiles = jest.fn()
    const cleanupArchiveParts = jest.fn()

    const result = await deployPrebuiltWithFallback({
      baseArgs,
      env: { TEST: '1' },
      cwd: '/tmp',
      run,
      cleanupArchiveParts,
      onMissingFiles,
    })

    expect(result).toEqual({ usedArchive: true })
    expect(run).toHaveBeenCalledTimes(2)
    expect(onMissingFiles).toHaveBeenCalledTimes(1)
    expect(cleanupArchiveParts).toHaveBeenCalledTimes(1)

    const archiveArgs = run.mock.calls[1][0]
    expect(archiveArgs).toEqual([
      'deploy',
      '--prebuilt',
      '--archive=tgz',
      '--local-config',
      '/tmp/vercel.json',
      '--yes',
    ])
  })

  test('does not loop infinitely when archive retry also fails', async () => {
    const err = new Error('missing_files again')
    err.stdout = 'missing_files'

    const run = jest.fn().mockRejectedValue(err)
    const baseArgs = ['deploy', '--prebuilt', '--local-config', '/tmp/vercel.json', '--yes']

    await expect(
      deployPrebuiltWithFallback({
        baseArgs,
        env: { TEST: '1' },
        cwd: '/tmp',
        run,
        cleanupArchiveParts: jest.fn(),
        onMissingFiles: jest.fn(),
      }),
    ).rejects.toThrow(/missing_files/i)

    expect(run).toHaveBeenCalledTimes(2)
  })

  test('throws immediately when error is not missing_files', async () => {
    const err = new Error('other error')
    err.stderr = 'boom'

    const run = jest.fn().mockRejectedValue(err)
    const baseArgs = ['deploy', '--prebuilt', '--local-config', '/tmp/vercel.json', '--yes']

    await expect(
      deployPrebuiltWithFallback({
        baseArgs,
        env: { TEST: '1' },
        cwd: '/tmp',
        run,
        cleanupArchiveParts: jest.fn(),
        onMissingFiles: jest.fn(),
      }),
    ).rejects.toThrow('other error')

    expect(run).toHaveBeenCalledTimes(1)
  })
})
