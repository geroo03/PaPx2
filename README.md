# 🛵 Ecosistema Puerta a Puerta (Estilo PedidoYa / Rappi)

¡Bienvenido al core de la plataforma! Este proyecto es una solución Full Stack de delivery unificada, diseñada con una arquitectura desacoplada para separar la lógica del cliente (Frontend) del motor de procesamiento, logística y pasarelas de pago (Backend).

## 📁 Estructura del Proyecto

```text
PUERTAAPUERTA-MAIN/
│
├── 🌐 frontend/                  # Aplicación del Cliente, Comercio y Cadete (Estático)
│   ├── assets/                   # Estilos (CSS), Multimedia y Lógica JS compartida
│   ├── cliente/                  # Vistas del buscador, carrito y órdenes del cliente
│   ├── comercio/                 # Panel de administración de locales (Habibi Rest, etc.)
│   ├── cadete/                   # Panel de tracking y gestión de viajes del repartidor
│   ├── admin/                    # Panel global de control administrativo
│   ├── api/                      # Funciones serverless de soporte
│   ├── env.js                    # Inicializador de claves públicas de Supabase
│   └── vercel.json               # Configuración de ruteo para despliegue en Vercel
│
├── 🚄 backend/                   # Motor centralizado de la plataforma (Node.js + Express)
│   ├── server.js                 # Servidor unificado (Auth, MercadoPago y Logística)
│   ├── .env                      # Variables de entorno secretas (Caja fuerte)
│   └── package.json              # Dependencias del servidor (Express, MercadoPago, etc.)
│
├── 🧠 supabase/                  # Consultas, triggers y políticas RLS de la base de datos
│   └── SUPABASE_ROLE_PLAYBOOK.sql
│
└── 🛠️ scripts/                   # Automatizaciones y herramientas de testeo
```

