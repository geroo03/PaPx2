/**
 * ChatPedido.jsx
 *
 * Componente visual del chat en tiempo real por pedido.
 * Consume useChatPedido y renderiza burbujas asimétricas, auto-scroll
 * y un formulario nativo compatible con el teclado virtual de iOS/Android.
 *
 * Props:
 *   pedidoId        {string}  UUID del pedido
 *   usuarioIdActual {string}  UUID del usuario en sesión (posiciona burbujas)
 *   rolActual       {string}  'cliente' | 'comercio' | 'cadete'
 *
 * ── Portabilidad React Native ────────────────────────────────────────────────
 * Los estilos son objetos JS camelCase idénticos a los de StyleSheet.create().
 * Para migrar a RN: reemplazar <div> → <View>, <span> → <Text>,
 * <input> → <TextInput>, <form> → <View> + onSubmitEditing en el TextInput,
 * <button> → <TouchableOpacity> y quitar propiedades web (boxShadow, etc.).
 */

import { useState, useEffect, useRef } from 'react';
import { useChatPedido } from '../hooks/useChatPedido';

// ─── Constantes ───────────────────────────────────────────────────────────────

// Mapeo de rol (clave de DB) → etiqueta visible encima de burbujas ajenas.
// Mapea también 'role' en inglés (columna de la tabla profiles) por si llega
// sin transformar desde el backend.
const ROL_ETIQUETA = {
  cliente:  'CLIENTE',
  comercio: 'COMERCIO',
  cadete:   'REPARTIDOR',
  admin:    'SOPORTE',
  // aliases en inglés (tabla profiles → columna role)
  customer: 'CLIENTE',
  merchant: 'COMERCIO',
  courier:  'REPARTIDOR',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatHora(iso) {
  try {
    return new Date(iso).toLocaleTimeString('es-AR', {
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return '';
  }
}

// ─── Componente ───────────────────────────────────────────────────────────────

export function ChatPedido({ pedidoId, usuarioIdActual, rolActual }) {

  const { mensajes, loading, error, enviando, enviarMensaje } =
    useChatPedido(pedidoId, rolActual);

  const [texto,    setTexto]    = useState('');
  const [errEnvio, setErrEnvio] = useState(null);

  // Ref para el auto-scroll: apunta a un <div> invisible al final de la lista.
  const endRef   = useRef(null);
  // Ref del input para devolver el foco después de enviar.
  const inputRef = useRef(null);

  // ── Auto-scroll ───────────────────────────────────────────────────────────
  // Se dispara en la carga inicial y cada vez que el array `mensajes` crece.
  // 'smooth' en Capacitor/WebView da la sensación nativa de WhatsApp/Telegram.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [mensajes]);

  // ── Envío del formulario ──────────────────────────────────────────────────
  // El <form onSubmit> hace que el botón "Ir" / "Enviar" del teclado virtual
  // de iOS y Android dispare esta función de forma nativa, sin configuración
  // adicional en Capacitor.
  const handleEnviar = async (e) => {
    e.preventDefault();
    const trimmed = texto.trim();
    if (!trimmed || enviando) return;

    setErrEnvio(null);
    const { error: sendError } = await enviarMensaje(trimmed);

    if (sendError) {
      setErrEnvio(sendError);
    } else {
      // Limpiar el input y devolver foco (UX fluido en mobile)
      setTexto('');
      inputRef.current?.focus();
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={styles.root}>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div style={styles.header}>
        <span style={styles.headerTitulo}>Chat del pedido</span>
        {error && (
          <span style={styles.errorBadge} title={error}>
            Sin conexión
          </span>
        )}
      </div>

      {/* ── Lista de mensajes ───────────────────────────────────────────── */}
      <div style={styles.lista}>

        {loading && (
          <div style={styles.centrado}>
            <span style={styles.textoTenue}>Cargando mensajes...</span>
          </div>
        )}

        {!loading && mensajes.length === 0 && (
          <div style={styles.centrado}>
            <span style={styles.textoTenue}>
              Todavía no hay mensajes. Sé el primero 💬
            </span>
          </div>
        )}

        {mensajes.map((msg) => {
          const esPropio = msg.remitente_id === usuarioIdActual;
          const etiqueta =
            ROL_ETIQUETA[msg.rol_remitente] ??
            msg.rol_remitente?.toUpperCase() ??
            '';

          return (
            <div
              key={msg.id}
              style={{
                ...styles.fila,
                justifyContent: esPropio ? 'flex-end' : 'flex-start',
              }}
            >
              <div style={esPropio ? styles.burbujaPropia : styles.burbujaAjena}>

                {/* Etiqueta de rol — solo en mensajes ajenos */}
                {!esPropio && (
                  <span style={styles.rolLabel}>{etiqueta}</span>
                )}

                <span style={esPropio ? styles.textoPropio : styles.textoAjeno}>
                  {msg.mensaje}
                </span>

                <span style={esPropio ? styles.horaPropia : styles.horaAjena}>
                  {formatHora(msg.creado_at)}
                </span>

              </div>
            </div>
          );
        })}

        {/* Ancla para auto-scroll: scrollIntoView() apunta aquí */}
        <div ref={endRef} style={styles.scrollAncla} />

      </div>

      {/* ── Barra de error de envío (aparece/desaparece) ───────────────── */}
      {errEnvio && (
        <div style={styles.errEnvioBar}>
          <span style={styles.errEnvioTexto}>⚠ {errEnvio}</span>
          <button
            onClick={() => setErrEnvio(null)}
            style={styles.errEnvioCerrar}
            aria-label="Cerrar error"
          >
            ✕
          </button>
        </div>
      )}

      {/* ── Formulario de envío ─────────────────────────────────────────── */}
      {/*
        <form onSubmit> es clave para mobile:
          · iOS Safari / Capacitor: el botón "Ir" del teclado dispara submit
          · Android Chrome / Capacitor: el botón "Enviar" del teclado ídem
          · Desktop: Enter en el input dispara submit
        Sin <form>, ninguno de estos comportamientos funciona sin código extra.
      */}
      <form onSubmit={handleEnviar} style={styles.form}>
        <input
          ref={inputRef}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Escribí un mensaje..."
          maxLength={1000}
          disabled={enviando}
          autoComplete="off"
          style={{
            ...styles.input,
            opacity: enviando ? 0.6 : 1,
          }}
        />
        <button
          type="submit"
          disabled={!texto.trim() || enviando}
          aria-label="Enviar mensaje"
          style={{
            ...styles.botonEnviar,
            opacity: !texto.trim() || enviando ? 0.45 : 1,
            cursor:  !texto.trim() || enviando ? 'not-allowed' : 'pointer',
          }}
        >
          {/* Ícono SVG inline — sin dependencia de librería de íconos */}
          <svg
            width="18" height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#fff"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </form>

    </div>
  );
}

// ─── Estilos ──────────────────────────────────────────────────────────────────
//
// Estructura idéntica a React Native StyleSheet.create({ ... }).
// Para migrar: importar StyleSheet de 'react-native' y envolver este objeto.
// Las propiedades incompatibles con RN están marcadas con /* web-only */.
//
// Paleta centralizada → un solo lugar para cambiar el tema.
const COLOR = {
  primario:    '#FF6B35',
  bubbleAjena: '#F1F3F4',
  textoAjeno:  '#3C3C3C',
  fondo:       '#FAFAFA',
  borde:       '#EBEBEB',
  placeholder: '#BBBBBB',
};

const styles = {

  // Contenedor raíz — flex column a altura completa del contenedor padre.
  // El padre debe tener height explícito (ej: height: '100dvh' en la page).
  root: {
    display:         'flex',          /* web-only */
    flexDirection:   'column',
    height:          '100%',
    maxWidth:        480,             /* web-only */
    margin:          '0 auto',        /* web-only */
    fontFamily:      "'Inter', system-ui, sans-serif", /* web-only */
    backgroundColor: COLOR.fondo,
    borderRadius:    16,
    overflow:        'hidden',        /* web-only */
    boxShadow:       '0 2px 20px rgba(0,0,0,0.08)', /* web-only */
  },

  header: {
    padding:         '12px 16px',
    backgroundColor: COLOR.primario,
    display:         'flex',          /* web-only */
    alignItems:      'center',
    justifyContent:  'space-between',
    flexShrink:      0,
  },
  headerTitulo: {
    color:         '#fff',
    fontWeight:    700,
    fontSize:      15,
    letterSpacing: '-0.01em',         /* web-only */
  },
  errorBadge: {
    backgroundColor: 'rgba(0,0,0,0.25)',
    color:           '#fff',
    fontSize:        11,
    fontWeight:      600,
    paddingTop:      3,
    paddingBottom:   3,
    paddingLeft:     10,
    paddingRight:    10,
    borderRadius:    20,
  },

  lista: {
    flex:          1,
    overflowY:     'auto',            /* web-only */
    padding:       14,
    display:       'flex',            /* web-only */
    flexDirection: 'column',
    gap:           8,                 /* web-only (RN: usar marginBottom en cada fila) */
    // Scroll inercial nativo en iOS Safari / Capacitor WKWebView
    WebkitOverflowScrolling: 'touch', /* web-only */
  },
  centrado: {
    flex:           1,
    display:        'flex',           /* web-only */
    alignItems:     'center',
    justifyContent: 'center',
    padding:        32,
  },
  textoTenue: {
    color:     COLOR.placeholder,
    fontSize:  13,
    textAlign: 'center',
  },

  fila: {
    display: 'flex',                  /* web-only */
    width:   '100%',
  },

  // Burbuja propia (derecha, naranja)
  burbujaPropia: {
    maxWidth:        '72%',
    backgroundColor: COLOR.primario,
    borderTopLeftRadius:    16,
    borderTopRightRadius:   4,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius:16,
    paddingTop:      8,
    paddingBottom:   8,
    paddingLeft:     12,
    paddingRight:    12,
    display:         'flex',          /* web-only */
    flexDirection:   'column',
    gap:             3,               /* web-only (RN: marginBottom en children) */
  },
  textoPropio: {
    color:      '#fff',
    fontSize:   14,
    lineHeight: '1.45',
    wordBreak:  'break-word',         /* web-only */
  },
  horaPropia: {
    fontSize:  10,
    color:     'rgba(255,255,255,0.60)',
    textAlign: 'right',
    marginTop: 2,
  },

  // Burbuja ajena (izquierda, gris claro, con etiqueta de rol encima)
  burbujaAjena: {
    maxWidth:        '72%',
    backgroundColor: COLOR.bubbleAjena,
    borderTopLeftRadius:     4,
    borderTopRightRadius:    16,
    borderBottomLeftRadius:  16,
    borderBottomRightRadius: 16,
    paddingTop:      8,
    paddingBottom:   8,
    paddingLeft:     12,
    paddingRight:    12,
    display:         'flex',          /* web-only */
    flexDirection:   'column',
    gap:             3,               /* web-only */
  },
  rolLabel: {
    fontSize:      10,
    fontWeight:    700,
    color:         COLOR.primario,
    letterSpacing: '0.07em',
    marginBottom:  1,
  },
  textoAjeno: {
    color:      COLOR.textoAjeno,
    fontSize:   14,
    lineHeight: '1.45',
    wordBreak:  'break-word',         /* web-only */
  },
  horaAjena: {
    fontSize:  10,
    color:     '#AAAAAA',
    textAlign: 'right',
    marginTop: 2,
  },

  // <div> invisible que actúa como ancla para scrollIntoView
  scrollAncla: {
    height: 1,
  },

  // Barra amarilla de error de envío
  errEnvioBar: {
    display:         'flex',          /* web-only */
    alignItems:      'center',
    justifyContent:  'space-between',
    backgroundColor: '#FFF3CD',
    paddingTop:      8,
    paddingBottom:   8,
    paddingLeft:     14,
    paddingRight:    14,
    flexShrink:      0,
  },
  errEnvioTexto: {
    fontSize: 12,
    color:    '#856404',
  },
  errEnvioCerrar: {
    background: 'none',               /* web-only */
    border:     'none',               /* web-only */
    color:      '#856404',
    fontSize:   14,
    cursor:     'pointer',            /* web-only */
    paddingLeft: 4,
    paddingRight: 4,
  },

  // Área de input fija al fondo
  form: {
    display:         'flex',          /* web-only */
    gap:             8,               /* web-only */
    paddingTop:      10,
    paddingBottom:   10,
    paddingLeft:     12,
    paddingRight:    12,
    backgroundColor: '#FFFFFF',
    borderTop:       `1px solid ${COLOR.borde}`, /* web-only */
    flexShrink:      0,
    alignItems:      'center',
  },
  input: {
    flex:            1,
    border:          `1.5px solid #E0E0E0`, /* web-only */
    borderRadius:    24,
    paddingTop:      10,
    paddingBottom:   10,
    paddingLeft:     16,
    paddingRight:    16,
    fontSize:        14,
    outline:         'none',          /* web-only */
    color:           '#222',
    backgroundColor: '#F8F8F8',
    // Elimina el highlight azul al tocar en iOS/Android (Capacitor WKWebView)
    WebkitTapHighlightColor: 'transparent', /* web-only */
  },
  botonEnviar: {
    width:           42,
    height:          42,
    borderRadius:    21,              // 50% como valor absoluto (RN no acepta '50%' en algunos casos)
    backgroundColor: COLOR.primario,
    border:          'none',          /* web-only */
    display:         'flex',          /* web-only */
    alignItems:      'center',
    justifyContent:  'center',
    flexShrink:      0,
    transition:      'opacity 0.15s ease', /* web-only */
    WebkitTapHighlightColor: 'transparent', /* web-only */
  },
};
