/**
 * importadorMenu.js — Parseo/validación puros para la carga masiva de
 * productos (CSV/Excel) del panel de comercio.
 *
 * Módulo 100% puro a propósito: sin DOM, sin `fetch`, sin Supabase. Así se
 * puede testear con `node:test` importándolo directo desde `backend/test/`
 * (import relativo cross-folder, ESM), igual que el resto de las funciones
 * puras del proyecto (ver backend/src/lib/*.js). El parseo del archivo en sí
 * (SheetJS) y la escritura en Supabase viven en comercio.js — acá solo entra
 * un array de filas ya parseadas (objetos header→valor) y sale un resultado
 * validado, listo para insertar o para mostrar en la previsualización.
 *
 * Formato del archivo: una sola tabla plana con columna discriminadora
 * `tipo_fila` (`producto` | `opcion`) — CSV no soporta múltiples hojas, así
 * que este es el diseño que funciona igual para .csv y .xlsx. Las filas de
 * opción referencian su producto por nombre, y deben estar en el MISMO
 * archivo que la fila del producto (no se pueden agregar opcionales a un
 * producto de una importación anterior — limitación de v1, documentada).
 *
 * precio_base es SIEMPRE neto, sin el 20% de recargo de la plataforma —
 * mismo criterio que el modal manual de "Agregar producto" (ver comercio.js,
 * saveProducto()). El recargo se aplica únicamente al mostrarle el precio al
 * cliente (cliente.js), nunca se persiste.
 */

export const COLUMNAS_ESPERADAS = [
  'tipo_fila', 'producto_nombre', 'descripcion', 'categoria', 'precio_base',
  'imagen_url', 'grupo_nombre', 'grupo_min', 'grupo_max', 'opcion_nombre', 'precio_extra',
];

const BOM = /^\uFEFF/;

// Comparación case/espacio-insensible — usada para matchear producto↔opción,
// detectar categorías/productos ya existentes, y duplicados dentro del
// archivo. No quita tildes a propósito: "café"/"cafe" deben seguir siendo
// nombres distintos, solo se ignoran mayúsculas y espacios repetidos.
export function normalizarNombre(str) {
  return String(str ?? '').replace(BOM, '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizarClaves(filaCruda) {
  const out = {};
  for (const [k, v] of Object.entries(filaCruda || {})) {
    const key = String(k).replace(BOM, '').trim().toLowerCase();
    out[key] = typeof v === 'string' ? v.trim() : v;
  }
  return out;
}

function filaEsVacia(fila) {
  return Object.values(fila).every(v => v === '' || v === null || v === undefined);
}

function parseNumero(raw) {
  if (raw === '' || raw === null || raw === undefined) return NaN;
  return parseFloat(String(raw).replace(',', '.'));
}

function parsearFilaProducto(fila) {
  const nombre      = String(fila.producto_nombre || '').trim();
  const categoria    = String(fila.categoria || '').trim();
  const descripcion  = String(fila.descripcion || '').trim();
  const imagenUrl    = String(fila.imagen_url || '').trim();
  const precioBase   = parseNumero(fila.precio_base);

  if (!nombre)     return { estado: 'error', motivo: 'Falta el nombre del producto (producto_nombre)' };
  if (!categoria)  return { estado: 'error', motivo: 'Falta la categoría' };
  if (!Number.isFinite(precioBase) || precioBase <= 0)
    return { estado: 'error', motivo: 'precio_base inválido — debe ser un número mayor a 0, sin el 20% de recargo' };

  return {
    estado: 'ok',
    producto: {
      nombre, descripcion, categoria, precio_base: precioBase,
      ...(imagenUrl ? { imagen_url: imagenUrl } : {}),
      grupos: [],
    },
  };
}

function parsearFilaOpcion(fila) {
  const productoNombre = String(fila.producto_nombre || '').trim();
  const grupoNombre    = String(fila.grupo_nombre || '').trim();
  const opcionNombre   = String(fila.opcion_nombre || '').trim();

  if (!productoNombre) return { estado: 'error', motivo: 'Falta producto_nombre en una fila de opción' };
  if (!grupoNombre)    return { estado: 'error', motivo: 'Falta grupo_nombre' };
  if (!opcionNombre)   return { estado: 'error', motivo: 'Falta opcion_nombre' };

  const grupoMinRaw = fila.grupo_min;
  const grupoMaxRaw = fila.grupo_max;
  const grupoMin = (grupoMinRaw === '' || grupoMinRaw == null) ? NaN : parseInt(grupoMinRaw, 10);
  const grupoMax = (grupoMaxRaw === '' || grupoMaxRaw == null) ? NaN : parseInt(grupoMaxRaw, 10);
  if (!Number.isInteger(grupoMin) || grupoMin < 0) return { estado: 'error', motivo: 'grupo_min inválido (debe ser un entero ≥ 0)' };
  if (!Number.isInteger(grupoMax) || grupoMax < 1) return { estado: 'error', motivo: 'grupo_max inválido (debe ser un entero ≥ 1)' };
  if (grupoMin > grupoMax)
    return { estado: 'error', motivo: `grupo_min (${grupoMin}) no puede ser mayor que grupo_max (${grupoMax})` };

  let precioExtra = 0;
  const precioExtraRaw = fila.precio_extra;
  if (precioExtraRaw !== '' && precioExtraRaw !== null && precioExtraRaw !== undefined) {
    precioExtra = parseNumero(precioExtraRaw);
    if (!Number.isFinite(precioExtra) || precioExtra < 0)
      return { estado: 'error', motivo: 'precio_extra inválido (no puede ser negativo)' };
  }

  return { estado: 'ok', opcion: { productoNombre, grupoNombre, grupoMin, grupoMax, opcionNombre, precioExtra } };
}

/**
 * Punto de entrada único. Recibe filas ya parseadas (array de objetos
 * header→valor, tal cual las devuelve XLSX.utils.sheet_to_json(sheet,
 * {defval:''}) en el caller) y el catálogo existente del comercio, para
 * poder detectar categorías/productos ya existentes sin tocar la base acá.
 *
 * Dos pasadas: 1) recolecta todas las filas `producto` (así el orden de
 * filas en el archivo no importa — una opción puede aparecer antes que su
 * producto); 2) procesa las filas `opcion` contra ese mapa, agrupando por
 * (producto, grupo) y detectando inconsistencias de mín/máx entre filas del
 * mismo grupo.
 */
export function procesarFilasImportacion(filasCrudas, { productosExistentes = [], categoriasExistentes = [] } = {}) {
  const productosExistentesNorm = new Set((productosExistentes || []).map(normalizarNombre));
  const categoriasExistentesSet = new Set((categoriasExistentes || []).map(normalizarNombre));

  const filas = [];                     // salida por fila, para la previsualización (se ordena al final)
  const productosPorNombre = new Map(); // key normalizada -> { producto, numeroFila }
  const nombresVistos = new Set();      // toda key de producto ya vista en el archivo (ok u omitida)
  const nombresOmitidos = new Set();    // key de producto que quedó omitida (duplicado o ya existente)

  // ── Pasada 1: filas `producto` ──────────────────────────────────────────
  filasCrudas.forEach((filaCruda, idx) => {
    const numeroFila = idx + 2; // fila 1 = header
    const fila = normalizarClaves(filaCruda);
    if (filaEsVacia(fila)) return; // se ignora en silencio, no cuenta como error
    if (normalizarNombre(fila.tipo_fila) !== 'producto') return; // se resuelve en la pasada 2

    const r = parsearFilaProducto(fila);
    if (r.estado === 'error') {
      filas.push({ numeroFila, tipo: 'producto', estado: 'error', motivo: r.motivo, datos: fila });
      return;
    }
    const key = normalizarNombre(r.producto.nombre);
    if (nombresVistos.has(key)) {
      nombresOmitidos.add(key);
      filas.push({ numeroFila, tipo: 'producto', estado: 'omitido', motivo: 'Producto duplicado en el archivo', datos: fila });
      return;
    }
    nombresVistos.add(key);
    if (productosExistentesNorm.has(key)) {
      nombresOmitidos.add(key);
      filas.push({ numeroFila, tipo: 'producto', estado: 'omitido', motivo: 'Ya existe un producto con este nombre — no se pisa, corregí el nombre y volvé a importar si querías actualizarlo', datos: fila });
      return;
    }
    productosPorNombre.set(key, { producto: r.producto, numeroFila });
    filas.push({ numeroFila, tipo: 'producto', estado: 'ok', motivo: null, datos: fila });
  });

  // ── Pasada 2: filas `opcion` (y cualquier tipo_fila desconocido) ────────
  const gruposPorKey = new Map(); // "prodKey::grupoKeyNorm" -> { prodKey, grupoNombre, entradas: [...] }

  filasCrudas.forEach((filaCruda, idx) => {
    const numeroFila = idx + 2;
    const fila = normalizarClaves(filaCruda);
    if (filaEsVacia(fila)) return;
    const tipo = normalizarNombre(fila.tipo_fila);
    if (tipo === 'producto') return; // ya procesada en la pasada 1
    if (tipo !== 'opcion') {
      filas.push({ numeroFila, tipo: 'desconocido', estado: 'error', motivo: `tipo_fila desconocido: "${fila.tipo_fila}"`, datos: fila });
      return;
    }

    const r = parsearFilaOpcion(fila);
    if (r.estado === 'error') {
      filas.push({ numeroFila, tipo: 'opcion', estado: 'error', motivo: r.motivo, datos: fila });
      return;
    }

    const prodKey = normalizarNombre(r.opcion.productoNombre);
    if (!productosPorNombre.has(prodKey)) {
      const omitido = nombresOmitidos.has(prodKey);
      filas.push({
        numeroFila, tipo: 'opcion',
        estado: omitido ? 'omitido' : 'error',
        motivo: omitido
          ? 'El producto asociado fue omitido (duplicado o ya existente) — esta opción tampoco se importa'
          : `No se encontró el producto "${r.opcion.productoNombre}" en este archivo`,
        datos: fila,
      });
      return;
    }

    const filaIdx = filas.push({ numeroFila, tipo: 'opcion', estado: 'ok', motivo: null, datos: fila }) - 1;
    const grupoKey = `${prodKey}::${normalizarNombre(r.opcion.grupoNombre)}`;
    if (!gruposPorKey.has(grupoKey)) gruposPorKey.set(grupoKey, { prodKey, grupoNombre: r.opcion.grupoNombre, entradas: [] });
    gruposPorKey.get(grupoKey).entradas.push({
      min: r.opcion.grupoMin, max: r.opcion.grupoMax,
      opcionNombre: r.opcion.opcionNombre, precioExtra: r.opcion.precioExtra, filaIdx,
    });
  });

  // ── Post-proceso: consistencia de mín/máx dentro de cada grupo + armado ─
  for (const { prodKey, grupoNombre, entradas } of gruposPorKey.values()) {
    const [primero, ...resto] = entradas;
    const inconsistente = resto.some(e => e.min !== primero.min || e.max !== primero.max);
    if (inconsistente) {
      entradas.forEach(e => {
        filas[e.filaIdx].estado = 'error';
        filas[e.filaIdx].motivo = `Valores de mínimo/máximo inconsistentes entre filas del grupo "${grupoNombre}"`;
      });
      continue;
    }
    const entry = productosPorNombre.get(prodKey);
    if (!entry) continue;
    entry.producto.grupos.push({
      nombre: grupoNombre,
      min_opciones: primero.min,
      max_opciones: primero.max,
      opciones: entradas.map(e => ({ nombre: e.opcionNombre, precio_extra: e.precioExtra })),
    });
  }

  filas.sort((a, b) => a.numeroFila - b.numeroFila);

  const categoriasNuevasMap = new Map();
  for (const { producto } of productosPorNombre.values()) {
    const catKey = normalizarNombre(producto.categoria);
    if (!categoriasExistentesSet.has(catKey) && !categoriasNuevasMap.has(catKey)) {
      categoriasNuevasMap.set(catKey, producto.categoria);
    }
  }

  const productos = [...productosPorNombre.values()].map(({ producto, numeroFila }) => ({
    ...producto, numeroFilaOrigen: numeroFila,
  }));

  const resumen = {
    totalFilas: filas.length,
    productosOk: productos.length,
    productosOmitidos: filas.filter(f => f.tipo === 'producto' && f.estado === 'omitido').length,
    opcionesOk: productos.reduce((acc, p) => acc + p.grupos.reduce((a, gr) => a + gr.opciones.length, 0), 0),
    filasConError: filas.filter(f => f.estado === 'error').length,
  };

  return { filas, productos, categoriasNuevas: [...categoriasNuevasMap.values()], resumen };
}

/** Genera el CSV descargable de ejemplo. String determinístico, sin DOM. */
export function generarPlantillaCSV() {
  const filasEjemplo = [
    ['producto', 'Hamburguesa Clásica', 'Con cheddar y panceta', 'Hamburguesas', '3500', 'https://midominio.com/img/hamb.jpg', '', '', '', '', ''],
    ['opcion', 'Hamburguesa Clásica', '', '', '', '', 'Tamaño', '1', '1', 'Chica', '0'],
    ['opcion', 'Hamburguesa Clásica', '', '', '', '', 'Tamaño', '1', '1', 'Grande', '600'],
    ['producto', 'Coca-Cola 500ml', '', 'Bebidas', '1200', '', '', '', '', '', ''],
  ];
  const escapeCsv = v => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lineas = [COLUMNAS_ESPERADAS, ...filasEjemplo].map(fila => fila.map(escapeCsv).join(','));
  return '\uFEFF' + lineas.join('\r\n');
}
