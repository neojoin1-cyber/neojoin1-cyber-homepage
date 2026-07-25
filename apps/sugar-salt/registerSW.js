(function removeLegacySugarSaltWorker() {
  if (!('serviceWorker' in navigator)) return

  navigator.serviceWorker.getRegistrations()
    .then(function unregisterLegacyWorkers(registrations) {
      var targets = registrations.filter(function isSugarSaltScope(registration) {
        try {
          return new URL(registration.scope).pathname.startsWith('/apps/sugar-salt/')
        } catch {
          return false
        }
      })

      return Promise.all(targets.map(function unregister(registration) {
        return registration.unregister()
      }))
    })
    .then(function reloadAfterCleanup(results) {
      if (!results.some(Boolean)) return
      if (sessionStorage.getItem('sugar-salt-worker-cleaned') === '1') return

      sessionStorage.setItem('sugar-salt-worker-cleaned', '1')
      window.location.reload()
    })
    .catch(function ignoreCleanupFailure() {
      // The trial still works when service workers are unavailable or blocked.
    })
})()
