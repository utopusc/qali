#!/usr/bin/env node
import {main} from '../lib/cli.mjs';
try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  console.error(`QaLi: ${error.message}`);
  process.exitCode = 2;
}
