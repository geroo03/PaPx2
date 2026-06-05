// mock-data.js
// Mock data for Puerta a Puerta (PaP) — frontend-only, no DB required.
// Exported shapes:
//  - commerces: Array of comercio objects
//  - paymentConfig: supported payment methods and sample account data
//  - helper: small util for placeholder images

const PLACEHOLDER = (text, w = 320, h = 200) => `https://via.placeholder.com/${w}x${h}?text=${encodeURIComponent(text)}`;

// Productos comunes
const sampleProducts = {
  pizza_muzza: {
    id: 'p-pizza-muzza',
    nombre: 'Pizza Muzza',
    descripcion: 'Base de muzzarella, salsa casera, orégano y aceite de oliva.',
    precio: 1590,
    foto: PLACEHOLDER('Pizza Muzza', 400, 300),
  },
  hamburguesa_full: {
    id: 'p-hamburguesa-full',
    nombre: 'Hamburguesa Completa',
    descripcion: 'Carne 200g, lechuga, tomate, queso, panceta y pickles.',
    precio: 1290,
    foto: PLACEHOLDER('Hamburguesa', 400, 300),
  },
  empanadas_x6: {
    id: 'p-empanadas-6',
    nombre: 'Empanadas x6',
    descripcion: 'Variedad: carne, jamón y queso, humita. Masa tradicional.',
    precio: 720,
    foto: PLACEHOLDER('Empanadas', 400, 300),
  },
  leche_1l: {
    id: 'p-leche-1l',
    nombre: 'Leche Entera 1L',
    descripcion: 'Leche larga vida, envase Tetra Pak 1 litro.',
    precio: 420,
    foto: PLACEHOLDER('Leche 1L', 300, 200),
  },
  pan_molde: {
    id: 'p-pan-molde',
    nombre: 'Pan de Molde',
    descripcion: 'Pan clásico de molde, 500g.',
    precio: 380,
    foto: PLACEHOLDER('Pan de Molde', 300, 200),
  }
};

// Comercios (cada uno con productos específicos)
export const commerces = [
  {
    id: 'c-001',
    nombre: 'La Piola Pizzería',
    rubro: 'Gastronomía',
    logo: PLACEHOLDER('La Piola', 120, 120),
    tiempo_entrega_min: 25,
    costo_envio: 120,
    rating: 4.7,
    direccion: 'Av. Corrientes 1342',
    telefono: '+54 11 4555-3322',
    productos: [
      { ...sampleProducts.pizza_muzza },
      { id: 'p-fugazza', nombre: 'Fugazza', descripcion: 'Cebolla, aceite de oliva y queso.', precio: 1490, foto: PLACEHOLDER('Fugazza', 400, 300) },
      { ...sampleProducts.empanadas_x6 }
    ]
  },
  {
    id: 'c-002',
    nombre: 'Farmacia Central',
    rubro: 'Farmacia',
    logo: PLACEHOLDER('Farmacia Central', 120, 120),
    tiempo_entrega_min: 40,
    costo_envio: 180,
    rating: 4.5,
    direccion: 'Calle San Martín 221',
    telefono: '+54 11 4788-1100',
    productos: [
      { ...sampleProducts.leche_1l },
      { id: 'p-analgesico', nombre: 'Analgesico 20 comprimidos', descripcion: 'Paracetamol 500mg - 20u.', precio: 350, foto: PLACEHOLDER('Medicamento', 300, 200) },
      { id: 'p-vitaminas', nombre: 'Vitaminas C 30u', descripcion: 'Suplemento vitamínico, 30 cápsulas.', precio: 890, foto: PLACEHOLDER('Vitaminas', 300, 200) }
    ]
  },
  {
    id: 'c-003',
    nombre: 'Super Mercado 24/7',
    rubro: 'Supermercado',
    logo: PLACEHOLDER('Super 24/7', 120, 120),
    tiempo_entrega_min: 35,
    costo_envio: 150,
    rating: 4.3,
    direccion: 'Av. Siempreviva 742',
    telefono: '+54 11 4999-0099',
    productos: [
      { ...sampleProducts.pan_molde },
      { id: 'p-leche-chocolate', nombre: 'Leche con Chocolate 1L', descripcion: 'Leche saborizada chocolate.', precio: 540, foto: PLACEHOLDER('Leche Choc', 300, 200) },
      { ...sampleProducts.hamburguesa_full }
    ]
  }
];

// Payment configuration — used by checkout UI to render method-specific forms
export const paymentConfig = {
  methods: [
    {
      id: 'efectivo',
      nombre: 'Efectivo',
      descripcion: 'Paga en efectivo al cadete. Si necesitás, deja en el pedido con cuánto vas a abonar.',
      fields: [
        { name: 'paga_con', label: 'Paga con (ej. $2000)', type: 'number', placeholder: 'Ej: 2000', required: false }
      ],
      fee: 0,
      icon: '💵'
    },
    {
      id: 'transferencia',
      nombre: 'Transferencia Bancaria',
      descripcion: 'Realizá la transferencia a la cuenta del comercio y adjuntá comprobante (simulado).',
      fields: [
        { name: 'alias', label: 'Alias', type: 'text', value: 'pap.comercio.123', readonly: true },
        { name: 'cbu', label: 'CBU', type: 'text', value: '0000000000000000000000', readonly: true },
        { name: 'banco', label: 'Banco', type: 'text', value: 'Banco Ejemplo S.A.', readonly: true },
        { name: 'comprobante', label: 'Comprobante (imagen)', type: 'file', required: false }
      ],
      fee: 0,
      icon: '🏦'
    },
    {
      id: 'tarjeta',
      nombre: 'Tarjeta (Crédito/Débito)',
      descripcion: 'Ingresá los datos de tu tarjeta. Esta es una simulación; en producción frec. se usa un gateway.',
      fields: [
        { name: 'card_number', label: 'Número de tarjeta', type: 'text', placeholder: '0000 0000 0000 0000', pattern: '[0-9 ]{12,19}', required: true },
        { name: 'expiry', label: 'Vencimiento (MM/AA)', type: 'text', placeholder: 'MM/AA', pattern: '(0[1-9]|1[0-2])\\/\\d{2}', required: true },
        { name: 'cvc', label: 'CVC', type: 'text', placeholder: '123', pattern: '\\d{3,4}', required: true },
        { name: 'card_name', label: 'Nombre en tarjeta', type: 'text', placeholder: 'Nombre y Apellido', required: true }
      ],
      fee: 0.03, // ejemplo: 3% de fee de tarjeta
      icon: '💳'
    }
  ],
  // UI hints for checkout forms
  ui: {
    showIcons: true,
    defaultMethod: 'efectivo'
  }
};

// Small helper used by UI to fetch a comercio by id
export function getComercioById(id) {
  return commerces.find(c => c.id === id) || null;
}

// Helper to format prices in ARS
export function formatPrice(value) {
  return '$' + Number(value).toLocaleString('es-AR');
}

// Default export (named) to import everything conveniently
export default {
  PLACEHOLDER,
  commerces,
  paymentConfig,
  getComercioById,
  formatPrice
};
