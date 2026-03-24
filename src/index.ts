#!/usr/bin/env node

import { Command } from 'commander'
import { registerInit } from './commands/init'
import { registerPublish } from './commands/publish'
import { registerSign } from './commands/sign'
import { registerVerify } from './commands/verify'
import { registerStatus } from './commands/status'

const program = new Command()

program
  .name('chainlock')
  .description('BSV-powered package integrity layer for software supply chains')
  .version('0.1.0')

registerInit(program)
registerPublish(program)
registerSign(program)
registerVerify(program)
registerStatus(program)

program.parse(process.argv)
