// Minimal push-notification service worker. Deliberately does nothing else
// (no offline caching, no asset interception) — this app isn't trying to be
// a full offline-first PWA, just needs a live service worker registration
// for the Push API to have somewhere to deliver messages to.

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "MitaPesa", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "MitaPesa";
  const options = {
    body: data.body || "",
    icon: "/mitapesa-icon.png",
    badge: "/mitapesa-icon.png",
    data: { url: data.url || "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
