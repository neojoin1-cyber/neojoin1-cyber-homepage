self.addEventListener('install', function install() {
  self.skipWaiting()
})

self.addEventListener('activate', function activate(event) {
  event.waitUntil(
    self.registration.unregister().then(function refreshOpenClients() {
      return self.clients.matchAll({ type: 'window' })
    }).then(function reloadClients(clients) {
      clients.forEach(function reloadClient(client) {
        client.navigate(client.url)
      })
    }),
  )
})
