// Real readiness test; also seeds the official Playwright AI planner.
import {test} from './fixtures.js';
import {expect} from '@playwright/test';
const status=(page:import('@playwright/test').Page)=>page.getByTestId('state');

test('TC-01 @smoke ready fixture reports simulation mode and idle state',async({page,session})=>{
  expect(session).toBeTruthy();
  const health=await page.request.get('/health');expect(health.ok()).toBeTruthy();
  expect(await health.json()).toEqual({name:'QaLi',mode:'simulation',status:'ok'});
  await expect(page.getByRole('heading',{name:'QaLi Workcell Simulator'})).toBeVisible();
  await expect(status(page)).toHaveText('idle');
  await expect(page.getByRole('checkbox',{name:'Guard closed'})).toBeChecked();
});
