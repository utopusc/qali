import {test as base,expect} from '@playwright/test';
export const test=base.extend<{session:string}>({session:async({page},use,testInfo)=>{
  const logs:string[]=[];
  page.on('console',m=>logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror',e=>logs.push(`[pageerror] ${e.message}`));
  await page.goto('/');
  await expect(page.getByTestId('session-id')).toHaveText(/[0-9a-f-]{36}/);
  const id=await page.getByTestId('session-id').innerText();
  try{await use(id);}finally{
    try{
      const response=await page.request.get(`/api/sessions/${id}`);
      expect(response.ok(),'Session audit must be readable').toBeTruthy();
      await testInfo.attach('simulation-audit',{body:await response.body(),contentType:'application/json'});
      await testInfo.attach('browser-console',{body:logs.join('\n'),contentType:'text/plain'});
    }finally{
      const response=await page.request.delete(`/api/sessions/${id}`);
      expect(response.ok(),'Session cleanup must succeed').toBeTruthy();
    }
  }
}});
