#!/usr/bin/env node

import { runWithVersionEnv } from '../lib/run-with-version-env.js'

runWithVersionEnv(process.argv.slice(2)).catch(error => {
  console.error('[dx-with-version-env] failed:', error?.message || String(error))
  process.exit(1)
})
