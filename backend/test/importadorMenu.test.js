import { test } from 'node:test';
import assert from 'node:assert/strict';
import { procesarFilasImportacion, generarPlantillaCSV, normalizarNombre } from '../../frontend/assets/js/importadorMenu.js';

// ─── producto simple válido ─────────────────────────────────────────────────

test('producto simple válido queda ok y se incluye en productos', () => {
  const r = procesarFilasImportacion([
    { tipo_fila: 'producto', producto_nombre: 'Pizza Muzzarella', descripcion: 'Con aceitunas', categoria: 'Pizzas', precio_base: '3000' },
  ]);
  assert.equal(r.filas[0].estado, 'ok');
  assert.equal(r.productos.length, 1);
  assert.equal(r.productos[0].nombre, 'Pizza Muzzarella');
  assert.equal(r.productos[0].precio_base, 3000);
  assert.equal(r.resumen.productosOk, 1);
  assert.equal(r.resumen.filasConError, 0);
});

// ─── producto + grupo con 2 opciones ────────────────────────────────────────

test('producto con un grupo de 2 opciones se asocia correctamente', () => {
  const r = procesarFilasImportacion([
    { tipo_fila: 'producto', producto_nombre: 'Hamburguesa', descripcion: '', categoria: 'Hamburguesas', precio_base: '2500' },
    { tipo_fila: 'opcion', producto_nombre: 'Hamburguesa', grupo_nombre: 'Tamaño', grupo_min: '1', grupo_max: '1', opcion_nombre: 'Chica', precio_extra: '0' },
    { tipo_fila: 'opcion', producto_nombre: 'Hamburguesa', grupo_nombre: 'Tamaño', grupo_min: '1', grupo_max: '1', opcion_nombre: 'Grande', precio_extra: '600' },
  ]);
  assert.equal(r.productos.length, 1);
  assert.equal(r.productos[0].grupos.length, 1);
  assert.equal(r.productos[0].grupos[0].nombre, 'Tamaño');
  assert.equal(r.productos[0].grupos[0].opciones.length, 2);
  assert.equal(r.resumen.opcionesOk, 2);
});

// ─── validaciones de producto ───────────────────────────────────────────────

test('falta producto_nombre → error descriptivo', () => {
  const r = procesarFilasImportacion([
    { tipo_fila: 'producto', producto_nombre: '', categoria: 'Pizzas', precio_base: '3000' },
  ]);
  assert.equal(r.filas[0].estado, 'error');
  assert.match(r.filas[0].motivo, /nombre/i);
  assert.equal(r.productos.length, 0);
});

test('precio_base inválido (negativo, no numérico o cero) → error', () => {
  for (const precio of ['-100', 'no-es-numero', '0', '']) {
    const r = procesarFilasImportacion([
      { tipo_fila: 'producto', producto_nombre: 'X', categoria: 'Cat', precio_base: precio },
    ]);
    assert.equal(r.filas[0].estado, 'error', `precio_base=${JSON.stringify(precio)} debería fallar`);
    assert.equal(r.productos.length, 0);
  }
});

// ─── categorías ──────────────────────────────────────────────────────────────

test('categoría nueva pasa a categoriasNuevas; categoría ya existente no se duplica', () => {
  const r = procesarFilasImportacion([
    { tipo_fila: 'producto', producto_nombre: 'A', categoria: 'Bebidas', precio_base: '1000' },
    { tipo_fila: 'producto', producto_nombre: 'B', categoria: 'Postres', precio_base: '1500' },
  ], { categoriasExistentes: ['Bebidas'] });
  assert.deepEqual(r.categoriasNuevas, ['Postres']);
});

// ─── filas de opción sin producto asociado ──────────────────────────────────

test('fila opcion cuyo producto no matchea ningún producto del archivo → error', () => {
  const r = procesarFilasImportacion([
    { tipo_fila: 'opcion', producto_nombre: 'No Existe', grupo_nombre: 'Tamaño', grupo_min: '1', grupo_max: '1', opcion_nombre: 'Chica', precio_extra: '0' },
  ]);
  assert.equal(r.filas[0].estado, 'error');
  assert.match(r.filas[0].motivo, /no se encontró el producto/i);
});

// ─── grupo min > max ─────────────────────────────────────────────────────────

test('grupo_min > grupo_max → error', () => {
  const r = procesarFilasImportacion([
    { tipo_fila: 'producto', producto_nombre: 'Empanada', categoria: 'Empanadas', precio_base: '500' },
    { tipo_fila: 'opcion', producto_nombre: 'Empanada', grupo_nombre: 'Relleno', grupo_min: '3', grupo_max: '1', opcion_nombre: 'Carne', precio_extra: '0' },
  ]);
  const filaOpcion = r.filas.find(f => f.tipo === 'opcion');
  assert.equal(filaOpcion.estado, 'error');
  assert.match(filaOpcion.motivo, /grupo_min.*grupo_max/i);
});

// ─── precio_extra negativo ───────────────────────────────────────────────────

test('precio_extra negativo → error', () => {
  const r = procesarFilasImportacion([
    { tipo_fila: 'producto', producto_nombre: 'Empanada', categoria: 'Empanadas', precio_base: '500' },
    { tipo_fila: 'opcion', producto_nombre: 'Empanada', grupo_nombre: 'Relleno', grupo_min: '1', grupo_max: '1', opcion_nombre: 'Carne', precio_extra: '-50' },
  ]);
  const filaOpcion = r.filas.find(f => f.tipo === 'opcion');
  assert.equal(filaOpcion.estado, 'error');
  assert.match(filaOpcion.motivo, /precio_extra/i);
});

// ─── filas vacías, BOM, columnas extra ──────────────────────────────────────

test('fila 100% vacía se ignora en silencio, no aparece en filas ni cuenta error', () => {
  const r = procesarFilasImportacion([
    { tipo_fila: 'producto', producto_nombre: 'A', categoria: 'Cat', precio_base: '1000' },
    { tipo_fila: '', producto_nombre: '', descripcion: '', categoria: '', precio_base: '' },
  ]);
  assert.equal(r.filas.length, 1);
  assert.equal(r.resumen.totalFilas, 1);
});

test('columnas extra desconocidas en el header no rompen el parseo', () => {
  const r = procesarFilasImportacion([
    { tipo_fila: 'producto', producto_nombre: 'A', categoria: 'Cat', precio_base: '1000', columna_rara: 'lo que sea', otra_mas: 123 },
  ]);
  assert.equal(r.filas[0].estado, 'ok');
});

test('BOM en la primera clave del header no rompe el parseo', () => {
  const filaConBOM = { '﻿tipo_fila': 'producto', producto_nombre: 'A', categoria: 'Cat', precio_base: '1000' };
  const r = procesarFilasImportacion([filaConBOM]);
  assert.equal(r.filas[0].estado, 'ok');
});

// ─── normalizarNombre / acentos y ñ ─────────────────────────────────────────

test('normalizarNombre compara nombres con tildes/ñ ignorando mayúsculas y espacios repetidos', () => {
  assert.equal(normalizarNombre('Salsa Ají'), normalizarNombre('  salsa   ají  '));
  assert.equal(normalizarNombre('Empanada'), normalizarNombre('EMPANADA'));
  assert.notEqual(normalizarNombre('Café'), normalizarNombre('Cafe')); // no saca tildes a propósito
});

// ─── imagen_url opcional ─────────────────────────────────────────────────────

test('imagen_url ausente: el producto resultante no rompe nada y no trae la clave', () => {
  const r = procesarFilasImportacion([
    { tipo_fila: 'producto', producto_nombre: 'A', categoria: 'Cat', precio_base: '1000' },
  ]);
  assert.equal(r.productos[0].imagen_url, undefined);
});

test('imagen_url presente se guarda tal cual, sin validar dominio/formato', () => {
  const r = procesarFilasImportacion([
    { tipo_fila: 'producto', producto_nombre: 'A', categoria: 'Cat', precio_base: '1000', imagen_url: 'no-es-una-url-valida' },
  ]);
  assert.equal(r.productos[0].imagen_url, 'no-es-una-url-valida');
});

// ─── duplicados ──────────────────────────────────────────────────────────────

test('producto ya existente en el catálogo del comercio → omitido, no se pisa', () => {
  const r = procesarFilasImportacion([
    { tipo_fila: 'producto', producto_nombre: 'Pizza Muzzarella', categoria: 'Pizzas', precio_base: '3000' },
  ], { productosExistentes: ['pizza muzzarella'] });
  assert.equal(r.filas[0].estado, 'omitido');
  assert.equal(r.productos.length, 0);
});

test('dos filas producto con el mismo nombre en el mismo archivo → la segunda queda omitida', () => {
  const r = procesarFilasImportacion([
    { tipo_fila: 'producto', producto_nombre: 'Pizza', categoria: 'Pizzas', precio_base: '3000' },
    { tipo_fila: 'producto', producto_nombre: 'Pizza', categoria: 'Pizzas', precio_base: '3200' },
  ]);
  assert.equal(r.filas[0].estado, 'ok');
  assert.equal(r.filas[1].estado, 'omitido');
  assert.equal(r.productos.length, 1);
});

test('opción cuyo producto quedó omitido también se omite (no error)', () => {
  const r = procesarFilasImportacion([
    { tipo_fila: 'producto', producto_nombre: 'Pizza', categoria: 'Pizzas', precio_base: '3000' },
  ], { productosExistentes: ['pizza'] });
  const r2 = procesarFilasImportacion([
    { tipo_fila: 'producto', producto_nombre: 'Pizza', categoria: 'Pizzas', precio_base: '3000' },
    { tipo_fila: 'opcion', producto_nombre: 'Pizza', grupo_nombre: 'Tamaño', grupo_min: '1', grupo_max: '1', opcion_nombre: 'Grande', precio_extra: '0' },
  ], { productosExistentes: ['pizza'] });
  assert.equal(r.filas[0].estado, 'omitido');
  const filaOpcion = r2.filas.find(f => f.tipo === 'opcion');
  assert.equal(filaOpcion.estado, 'omitido');
});

// ─── inconsistencia de mín/máx entre filas del mismo grupo ──────────────────

test('dos filas del mismo grupo con grupo_min/grupo_max distintos → ambas en error', () => {
  const r = procesarFilasImportacion([
    { tipo_fila: 'producto', producto_nombre: 'Hamburguesa', categoria: 'Hamburguesas', precio_base: '2500' },
    { tipo_fila: 'opcion', producto_nombre: 'Hamburguesa', grupo_nombre: 'Tamaño', grupo_min: '1', grupo_max: '1', opcion_nombre: 'Chica', precio_extra: '0' },
    { tipo_fila: 'opcion', producto_nombre: 'Hamburguesa', grupo_nombre: 'Tamaño', grupo_min: '0', grupo_max: '2', opcion_nombre: 'Grande', precio_extra: '600' },
  ]);
  const filasOpcion = r.filas.filter(f => f.tipo === 'opcion');
  assert.equal(filasOpcion.length, 2);
  assert.ok(filasOpcion.every(f => f.estado === 'error'));
  assert.match(filasOpcion[0].motivo, /inconsistentes/i);
  // El producto se importa igual, pero sin ese grupo inconsistente.
  assert.equal(r.productos[0].grupos.length, 0);
});

// ─── orden de filas ──────────────────────────────────────────────────────────

test('una fila opcion ANTES que su fila producto en el archivo igual se asocia bien', () => {
  const r = procesarFilasImportacion([
    { tipo_fila: 'opcion', producto_nombre: 'Hamburguesa', grupo_nombre: 'Tamaño', grupo_min: '1', grupo_max: '1', opcion_nombre: 'Chica', precio_extra: '0' },
    { tipo_fila: 'producto', producto_nombre: 'Hamburguesa', categoria: 'Hamburguesas', precio_base: '2500' },
  ]);
  assert.equal(r.productos.length, 1);
  assert.equal(r.productos[0].grupos[0]?.opciones.length, 1);
});

// ─── plantilla descargable ───────────────────────────────────────────────────

test('generarPlantillaCSV trae las 11 columnas esperadas y ejemplos de cada tipo de fila', () => {
  const csv = generarPlantillaCSV();
  assert.match(csv, /tipo_fila,producto_nombre,descripcion,categoria,precio_base,imagen_url,grupo_nombre,grupo_min,grupo_max,opcion_nombre,precio_extra/);
  assert.match(csv, /^producto,/m);
  assert.match(csv, /^opcion,/m);
});
