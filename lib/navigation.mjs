/**
 * Restrict document navigation to the selected application's origin. Subresources
 * keep their normal origins. Fetch response interception is needed because a
 * Playwright route handler does not run again for HTTP redirect hops.
 */
export async function installNavigationGuard(context, baseURL) {
  const origin = new URL(baseURL).origin;
  const pageGuards = new WeakMap();
  let violation;

  function recordViolation() {
    violation ??= new Error('Navigation outside the selected origin is blocked.');
    return violation;
  }

  function isAllowed(url) {
    try {
      const destination = new URL(url);
      return destination.origin === origin && !destination.username && !destination.password;
    } catch {
      return false;
    }
  }

  function protectPage(page) {
    if (!pageGuards.has(page)) {
      pageGuards.set(page, (async () => {
        const session = await context.newCDPSession(page);
        session.on('Fetch.requestPaused', async (event) => {
          try {
            const location = event.responseHeaders?.find((header) => header.name.toLowerCase() === 'location')?.value;
            const isRedirect = [301, 302, 303, 307, 308].includes(event.responseStatusCode);
            let destination = event.request.url;
            if (isRedirect && location) destination = new URL(location, destination).href;
            if (!isAllowed(destination)) {
              recordViolation();
              await session.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'BlockedByClient' });
            } else {
              await session.send('Fetch.continueRequest', { requestId: event.requestId });
            }
          } catch (error) {
            // A closing page may invalidate an in-flight paused request. Any
            // other interception failure fails the test rather than opening scope.
            if (!page.isClosed()) {
              violation ??= new Error('Navigation scope guard failed before the destination could be verified.');
              await session.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'BlockedByClient' }).catch(() => {});
            }
          }
        });
        await session.send('Fetch.enable', {
          patterns: [{ urlPattern: '*', resourceType: 'Document', requestStage: 'Response' }],
        });
      })());
    }
    return pageGuards.get(page);
  }

  context.on('page', (page) => {
    protectPage(page).catch(() => {
      violation ??= new Error('Navigation scope guard could not protect a new page.');
    });
  });

  await context.route('**/*', async (route) => {
    const request = route.request();
    if (!request.isNavigationRequest()) return route.continue();
    if (!isAllowed(request.url())) {
      recordViolation();
      return route.abort('blockedbyclient');
    }
    try {
      await protectPage(request.frame().page());
      await route.continue();
    } catch (error) {
      violation ??= new Error('Navigation scope could not be verified before a new page opened. Open that destination directly in a separate plan.');
      await route.abort('blockedbyclient').catch(() => {});
    }
  });

  return {
    ready: protectPage,
    assertAllowed() {
      if (violation) throw violation;
    },
  };
}
