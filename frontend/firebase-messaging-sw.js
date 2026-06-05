/* Deprecado: Usando Web Push nativo (VAPID) para evitar conflictos de scope
   y mantener un único service worker en la aplicación.

   El contenido original de este archivo (Firebase Messaging service worker)
   ha sido comentado para evitar que dos service workers intenten controlar
   la misma scope y provoquen comportamientos inesperados.

   Si en el futuro se decide volver a usar Firebase Messaging, reactivar
   el siguiente bloque y mover las claves/config a un entorno seguro.
*/

/*
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyAdRnQQ-ZlZnZLEqbH0rNc5CExwWxMkVdE",
  authDomain: "puerta-a-puerta-dc67c.firebaseapp.com",
  projectId: "puerta-a-puerta-dc67c",
  storageBucket: "puerta-a-puerta-dc67c.firebasestorage.app",
  messagingSenderId: "685654039640",
  appId: "1:685654039640:web:28f9f623c7642a4ef87e2d",
  measurementId: "G-Z1QKZBRSGX"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const { title, body, icon } = payload.notification;
  self.registration.showNotification(title, {
    body,
    icon: icon || '/icons/icon-192.png'
  });
});
*/
