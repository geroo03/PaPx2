// assets/js/state.js

/**
 * Gestor de estado global con persistencia en localStorage para PWA offline
 */
export const state = {
  // Estado en memoria
  cart: {},
  currentComercio: null,
  currentPedido: null,
  user: null,

  // Claves de localStorage
  KEYS: {
    CART: 'app_cart',
    COMERCIO: 'app_current_comercio',
    PEDIDO: 'app_current_pedido'
  },

  // Inicializar estado desde localStorage
  init() {
    try {
      const savedCart = localStorage.getItem(this.KEYS.CART);
      if (savedCart) this.cart = JSON.parse(savedCart);

      const savedComercio = localStorage.getItem(this.KEYS.COMERCIO);
      if (savedComercio) this.currentComercio = JSON.parse(savedComercio);

      const savedPedido = localStorage.getItem(this.KEYS.PEDIDO);
      if (savedPedido) this.currentPedido = JSON.parse(savedPedido);
    } catch (e) {
      console.warn('Error leyendo estado local:', e);
    }
  },

  // -------------------------
  // METODOS DEL CARRITO
  // -------------------------
  addToCart(id, name, price, qty = 1) {
    if (!this.cart[id]) {
      this.cart[id] = { name, price, q: 0 };
    }
    this.cart[id].q += qty;
    if (this.cart[id].q <= 0) {
      delete this.cart[id];
    }
    this.saveCart();
  },

  clearCart() {
    this.cart = {};
    this.saveCart();
  },

  saveCart() {
    localStorage.setItem(this.KEYS.CART, JSON.stringify(this.cart));
  },

  getCartTotal() {
    return Object.values(this.cart).reduce((sum, item) => sum + (item.price * item.q), 0);
  },

  // -------------------------
  // METODOS DE COMERCIO
  // -------------------------
  setComercio(comercio) {
    this.currentComercio = comercio;
    if (comercio) {
      localStorage.setItem(this.KEYS.COMERCIO, JSON.stringify(comercio));
    } else {
      localStorage.removeItem(this.KEYS.COMERCIO);
    }
  },

  // -------------------------
  // METODOS DE PEDIDO
  // -------------------------
  setPedido(pedido) {
    this.currentPedido = pedido;
    if (pedido) {
      localStorage.setItem(this.KEYS.PEDIDO, JSON.stringify(pedido));
    } else {
      localStorage.removeItem(this.KEYS.PEDIDO);
    }
  }
};
