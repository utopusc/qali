// Adapted from Microsoft's create-playwright starter; see THIRD_PARTY_NOTICES.md.
import { defineConfig, devices } from '@playwright/test';
const port=Number(process.env.QALI_PORT||4173);
const run=process.env.QALI_RUN||'regression';
if(!Number.isInteger(port)||port<1024||port>65535) throw new Error('Invalid QALI_PORT');
if(!/^[a-z0-9-]+$/.test(run)) throw new Error('Invalid QALI_RUN');
const baseURL=`http://127.0.0.1:${port}`;
export default defineConfig({
  testDir:'./tests',testMatch:'**/*.spec.ts',fullyParallel:true,
  forbidOnly:true,retries:0,workers:2,timeout:15_000,expect:{timeout:3_000},
  outputDir:`artifacts/${run}/test-results`,
  reporter:[['list'],['html',{outputFolder:`artifacts/${run}/html`,open:'never'}],['json',{outputFile:`artifacts/${run}/results.json`}],['junit',{outputFile:`artifacts/${run}/junit.xml`}]],
  use:{baseURL,trace:'retain-on-failure',screenshot:'only-on-failure',video:'retain-on-failure'},
  projects:[{name:'chromium',use:{...devices['Desktop Chrome'],launchOptions:process.env.QALI_BROWSER_PATH?{executablePath:process.env.QALI_BROWSER_PATH}:{}}}],
  webServer:{command:'node demo/server.mjs',url:`${baseURL}/health`,reuseExistingServer:false,timeout:15_000,gracefulShutdown:{signal:'SIGTERM',timeout:3000}},
});
