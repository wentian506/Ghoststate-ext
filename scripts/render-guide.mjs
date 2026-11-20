// Render the self-contained HTML guide without a preview server or network resources.
import {chromium} from 'playwright';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try {
  const page=await browser.newPage({viewport:{width:1000,height:1200}});
  const external=[];page.on('request',r=>{if(/^https?:/.test(r.url()))external.push(r.url());});
  await page.goto(pathToFileURL(path.resolve('docs/GhostState_Simple_Guide.html')).href);
  await page.emulateMedia({media:'print'});await page.evaluate(()=>document.fonts.ready);
  const layout=await page.locator('section.page').evaluateAll(sections=>sections.map(section=>{
    const footer=section.querySelector('.footer').getBoundingClientRect();
    const content=[...section.children].filter(x=>!x.classList.contains('footer')).map(x=>x.getBoundingClientRect().bottom);
    return {bottom:Math.max(...content),footerTop:footer.top};
  }));
  assert.equal(layout.length,4,'expected four guide sections');
  for(const [i,item] of layout.entries())assert(item.bottom+4<item.footerTop,`Guide content overlaps footer on page ${i+1}`);
  assert.deepEqual(external,[],'guide must remain self-contained');
  await page.pdf({path:'docs/GhostState_Simple_Guide.pdf',format:'A4',printBackground:true,preferCSSPageSize:true,tagged:true});
  console.log('Rendered four-page tagged guide; no footer overlap or external network resources.');
} finally {await browser.close();}
