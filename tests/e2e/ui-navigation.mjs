// Use the actually visible navigation, including the short-landscape layout.
export const screens=['overview','portals','workflows','devices','activity','security','compatibility','welcome','help'];
const directMobile=new Set(['overview','portals','workflows','devices']);
export async function navigate(page,screen) {
  if(await page.locator('.mobile-nav').isVisible()) {
    if(directMobile.has(screen)) {
      await page.locator(`.mobile-nav [data-screen="${screen}"]`).click();
    } else {
      const more=page.locator('.mobile-nav [data-action="mobile-more"]');
      if(await more.getAttribute('aria-expanded')!=='true') await more.click();
      await page.locator(`.mobile-more-panel [data-screen="${screen}"]`).click();
    }
  } else {
    await page.locator(`.nav-button[data-screen="${screen}"]`).click();
  }
}
