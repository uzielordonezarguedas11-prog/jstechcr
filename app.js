import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
    initializeFirestore,
    doc,
    getDoc,
    updateDoc,
    deleteDoc,
    collection,
    query,
    orderBy,
    limit,
    onSnapshot,
    writeBatch,
    arrayUnion,
    getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
    getAuth,
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyBHdtd1YLq8z_cuVgUDx33Z088okq0Sriw",
    authDomain: "servicio-tecnico-1d91f.firebaseapp.com",
    projectId: "servicio-tecnico-1d91f",
    storageBucket: "servicio-tecnico-1d91f.firebasestorage.app",
    messagingSenderId: "475926146823",
    appId: "1:475926146823:web:1bd26d301c1ad0d25f5fa2"
};

const CONFIG = {
    prefijo: "506",
    baseUrl: "https://jstechcr-clientes.vercel.app/"
};

const URL_GOOGLE_DRIVE = "https://script.google.com/macros/s/AKfycbw37r2nI4NiFB2tlE9K31RTFY7fSh30mBMOVlnpGAn0qEow65hztlfxSzVSudGgf2cH1Q/exec";

const ESTADOS = [
    "Recibido",
    "En diagnóstico",
    "Esperando repuesto",
    "En reparación",
    "Listo para entrega",
    "Entregado"
];

const app = initializeApp(firebaseConfig);
const db = initializeFirestore(app, {
    experimentalForceLongPolling: true
});
const auth = getAuth(app);

const $ = id => document.getElementById(id);
let unsubscribe = null;
let dispositivos = [];
let contactosMap = {};
let operacionEnCurso = false;
let versionDetalle = 0;

function escapar(valor) {
    return String(valor ?? "").replace(/[&<>"']/g, caracter => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[caracter]);
}

function formatearFecha(fecha) {
    if (!fecha) return "Fecha no disponible";
    const fechaReal = typeof fecha === "number"
        ? new Date(fecha)
        : fecha.toDate
            ? fecha.toDate()
            : new Date(fecha);
    if (Number.isNaN(fechaReal.getTime())) {
        return "Fecha no disponible";
    }
    return fechaReal.toLocaleString("es-CR", {
        dateStyle: "medium",
        timeStyle: "short"
    });
}

function mostrarMensaje(contenedor, mensaje, tipo = "") {
    const el = $(contenedor);
    if (!el) return;
    el.innerHTML = `
        <div class="message ${tipo}">
            ${escapar(mensaje)}
        </div>
    `;
}

function obtenerEstadoSeguro(estado) {
    const indice = ESTADOS.indexOf(estado);
    return indice >= 0 ? indice : 0;
}

function insignia(estado) {
    return `
        <span class="badge status-${obtenerEstadoSeguro(estado)}">
            ${escapar(estado || ESTADOS[0])}
        </span>
    `;
}

function insigniaPrioridad(prioridad) {
    const tipoPrio = prioridad === "Urgente" ? "prio-urgente" : "prio-normal";
    return `
        <span class="badge-prio ${tipoPrio}">
            ${escapar(prioridad || "Normal")}
        </span>
    `;
}

function generarCodigo() {
    const caracteres = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    let codigo = "RP-";
    for (let i = 0; i < 6; i++) {
        codigo += caracteres[
            Math.floor(Math.random() * caracteres.length)
        ];
    }
    return codigo;
}

function enlaceCliente(codigo) {
    const url = new URL(CONFIG.baseUrl);
    url.searchParams.set("c", codigo);
    return url.href;
}

async function copiarTexto(texto) {
    try {
        await navigator.clipboard.writeText(texto);
        alert("Copiado correctamente.");
    } catch {
        window.prompt("Copia este texto:", texto);
    }
}

function establecerCarga(boton, cargando, textoOriginal) {
    if (!boton) return;
    boton.disabled = cargando;
    boton.textContent = cargando ? "Procesando..." : textoOriginal;
}

/* =========================
   INICIO DE SESIÓN
========================= */
const loginForm = $("loginForm");
if (loginForm) {
    loginForm.addEventListener("submit", async evento => {
        evento.preventDefault();
        const boton = $("bl");
        establecerCarga(boton, true, "Entrar al panel");
        const le = $("le");
        if (le) le.innerHTML = "";
        try {
            await signInWithEmailAndPassword(
                auth,
                $("em").value.trim(),
                $("pw").value
            );
        } catch (error) {
            const mensajes = {
                "auth/invalid-credential": "Correo o contraseña incorrectos.",
                "auth/wrong-password": "Correo o contraseña incorrectos.",
                "auth/user-not-found": "El usuario no existe en Firebase Authentication.",
                "auth/invalid-email": "El correo electrónico no es válido.",
                "auth/operation-not-allowed": "Activa el acceso por correo y contraseña en Firebase.",
                "auth/unauthorized-domain": "Autoriza este dominio en Firebase Authentication.",
                "auth/network-request-failed": "Error de conexión. Revisa tu Internet.",
                "auth/too-many-requests": "Demasiados intentos. Espera antes de volver a probar."
            };
            mostrarMensaje(
                "le",
                mensajes[error.code] || `No se pudo iniciar sesión: ${error.message}`,
                "error"
            );
        } finally {
            establecerCarga(boton, false, "Entrar al panel");
        }
    });
}

const btnCerrar = $("bo");
if (btnCerrar) {
    btnCerrar.addEventListener("click", async () => {
        try {
            await signOut(auth);
        } catch (error) {
            alert("No se pudo cerrar la sesión: " + error.message);
        }
    });
}

onAuthStateChanged(auth, usuario => {
    const lg = $("lg");
    const ap = $("ap");
    if (usuario) {
        if (lg) lg.classList.add("hidden");
        if (ap) ap.classList.remove("hidden");
        escucharDispositivos();
    } else {
        if (lg) lg.classList.remove("hidden");
        if (ap) ap.classList.add("hidden");
        dispositivos = [];
        contactosMap = {};
        versionDetalle++;
        const ls = $("ls");
        if (ls) ls.textContent = "Inicia sesión para consultar los equipos.";
        const dt = $("dt");
        if (dt) dt.innerHTML = "";
        actualizarEstadisticas();
    }
    if (unsubscribe && !usuario) {
        unsubscribe();
        unsubscribe = null;
    }
});

/* =========================
   REGISTRAR DISPOSITIVO
========================= */
const deviceForm = $("deviceForm");
if (deviceForm) {
    deviceForm.addEventListener("submit", async evento => {
        evento.preventDefault();
        if (operacionEnCurso) return;
        const boton = $("bs");
        const nombre = $("f_cli").value.trim();
        const telefono = $("f_tel").value.trim();
        const telefono2 = $("f_tel2").value.trim();
        const correo = $("f_email").value.trim();
        const direccion = $("f_dir").value.trim();
        const tipo = $("f_tip").value;
        const marca = $("f_mar").value.trim();
        const modelo = $("f_mod").value.trim();
        const color = $("f_col").value.trim();
        const serie = $("f_ser").value.trim();
        const costo = $("f_cos").value.trim();
        const prioridad = $("f_prio") ? $("f_prio").value : "Normal";
        const problema = $("f_pro").value.trim();
        const observaciones = $("f_obs") ? $("f_obs").value.trim() : "";

        if (!nombre || !marca || !modelo || !problema || !serie || !observaciones) {
            mostrarMensaje("ok", "Por favor completa todos los campos obligatorios.", "error");
            return;
        }

        if (costo && (!Number.isFinite(Number(costo)) || Number(costo) < 0)) {
            mostrarMensaje("ok", "El costo debe ser igual o mayor que cero.", "error");
            return;
        }

        operacionEnCurso = true;
        establecerCarga(boton, true, "Registrar y generar código");
        const okEl = $("ok");
        if (okEl) okEl.innerHTML = "";

        try {
            let codigo = null;
            for (let i = 0; i < 10; i++) {
                const candidato = generarCodigo();
                const existente = await getDoc(doc(db, "repairs", candidato));
                if (!existente.exists()) {
                    codigo = candidato;
                    break;
                }
            }
            if (!codigo) {
                throw new Error("No se pudo generar un código disponible.");
            }

            const ahora = Date.now();
            const registro = {
                codigo,
                tipo,
                marca,
                modelo,
                color,
                serie,
                problema,
                observaciones,
                costo,
                prioridad,
                estado: ESTADOS[0],
                creado: ahora,
                actualizado: ahora,
                historial: [{
                    estado: ESTADOS[0],
                    nota: "Equipo recibido",
                    fecha: ahora
                }],
                fotos: []
            };

            const lote = writeBatch(db);
            lote.set(doc(db, "repairs", codigo), registro);
            lote.set(doc(db, "contacts", codigo), {
                cliente: nombre,
                telefono,
                telefono2,
                correo,
                direccion
            });
            await lote.commit();

            if (okEl) {
                okEl.innerHTML = `
                    <div class="message success">
                        <strong>¡Dispositivo registrado correctamente!</strong>
                        <p class="muted">Código de seguimiento:</p>
                        <div class="code">${escapar(codigo)}</div>
                        <button class="btn btn-secondary" id="imprimirNuevo" type="button">
                            Imprimir ticket
                        </button>
                        <button class="btn btn-neutral" id="copiarCodigoNuevo" type="button">
                            Copiar código
                        </button>
                        <button class="btn btn-neutral" id="copiarEnlaceNuevo" type="button">
                            Copiar enlace
                        </button>
                    </div>
                `;
                $("imprimirNuevo")?.addEventListener("click", () => {
                    imprimirTicket(
                        codigo, registro, nombre, telefono,
                        telefono2, correo, direccion
                    );
                });
                $("copiarCodigoNuevo")?.addEventListener("click", () => {
                    copiarTexto(codigo);
                });
                $("copiarEnlaceNuevo")?.addEventListener("click", () => {
                    copiarTexto(enlaceCliente(codigo));
                });
            }
            deviceForm.reset();
        } catch (error) {
            console.error(error);
            mostrarMensaje(
                "ok",
                "No se pudo registrar el equipo. Revisa Firebase. " + error.message,
                "error"
            );
        } finally {
            operacionEnCurso = false;
            establecerCarga(boton, false, "Registrar y generar código");
        }
    });
}

/* =========================
   ESTADÍSTICAS
========================= */
function actualizarEstadisticas() {
    const s1 = $("s1");
    const s2 = $("s2");
    const s3 = $("s3");
    const s4 = $("s4");
    if (s1) s1.textContent = dispositivos.length;
    if (s2) {
        s2.textContent = dispositivos.filter(registro =>
            ["Recibido", "En diagnóstico", "Esperando repuesto", "En reparación"]
                .includes(registro.estado)
        ).length;
    }
    if (s3) {
        s3.textContent = dispositivos.filter(registro =>
            registro.estado === "Listo para entrega"
        ).length;
    }
    if (s4) {
        s4.textContent = dispositivos.filter(registro =>
            registro.estado === "Entregado"
        ).length;
    }
}

/* =========================
   ESCUCHAR FIRESTORE
========================= */
function escucharDispositivos() {
    const ls = $("ls");
    if (ls) ls.textContent = "Cargando dispositivos...";
    const consulta = query(
        collection(db, "repairs"),
        orderBy("creado", "desc"),
        limit(200)
    );
    unsubscribe = onSnapshot(consulta, async resultado => {
        dispositivos = resultado.docs.map(documento => ({
            id: documento.id,
            ...documento.data()
        }));
        try {
            const contactosSnap = await getDocs(collection(db, "contacts"));
            contactosMap = {};
            contactosSnap.forEach(docSnap => {
                contactosMap[docSnap.id] = docSnap.data().cliente;
            });
        } catch (e) {
            console.warn("No se pudieron cargar los contactos para la lista", e);
        }
        actualizarEstadisticas();
        renderizarLista();
    }, error => {
        console.error(error);
        mostrarMensaje(
            "ls",
            "No se pudieron cargar los dispositivos. Revisa las reglas de Firestore.",
            "error"
        );
    });
}

/* =========================
   BÚSQUEDA Y FILTROS
========================= */
const inputBusqueda = $("fq");
if (inputBusqueda) {
    inputBusqueda.addEventListener("input", renderizarLista);
}
const selectFiltroEstado = $("fe");
if (selectFiltroEstado) {
    selectFiltroEstado.addEventListener("change", renderizarLista);
}

function renderizarLista() {
    const ls = $("ls");
    if (!ls) return;
    const busqueda = $("fq")
        ? $("fq").value.trim().toLowerCase()
        : "";
    const estado = $("fe") ? $("fe").value : "";
    const filtrados = dispositivos.filter(registro => {
        const coincideEstado = !estado || registro.estado === estado;
        const nombreCliente = contactosMap[registro.id] || "";
        const texto = [
            nombreCliente,
            registro.id,
            registro.tipo,
            registro.marca,
            registro.modelo,
            registro.color,
            registro.serie,
            registro.problema
        ].join(" ").toLowerCase();
        return coincideEstado && texto.includes(busqueda);
    });
    if (!filtrados.length) {
        ls.innerHTML = `
            <div class="message">
                No se encontraron dispositivos con esos criterios.
            </div>
        `;
        return;
    }
    ls.innerHTML = filtrados.map(registro => {
        const nombreCliente = contactosMap[registro.id] || "Sin nombre";
        const detalleEquipo = [registro.marca, registro.modelo, registro.color]
            .filter(Boolean)
            .join(" ") || "Equipo registrado";
        const textoSerie = registro.serie ? `Serie: ${registro.serie}` : "Sin número de serie";
        return `
        <div class="device-row" data-id="${escapar(registro.id)}">
            <div class="device-info">
                <div class="device-header">
                    <div>
                        <strong>${escapar(nombreCliente)}</strong>
                        <small>${escapar(registro.tipo)} · ${escapar(detalleEquipo)}</small>
                        <small style="margin-top: 4px; font-weight: 600; color: #475569;">${escapar(textoSerie)}</small>
                    </div>
                    <div>
                        ${insigniaPrioridad(registro.prioridad)}
                    </div>
                </div>
                <div class="badges-container" style="margin-top: 10px;">
                    ${insignia(registro.estado)}
                </div>
                <div class="device-actions">
                    <button type="button"
                        class="btn-edit edit-device"
                        data-id="${escapar(registro.id)}">
                        ✏️ Editar
                    </button>
                    <button type="button"
                        class="btn-delete delete-device"
                        data-id="${escapar(registro.id)}">
                        🗑 Eliminar
                    </button>
                </div>
                <div style="margin-top: 10px;">
                    <button type="button"
                        class="btn btn-neutral view-device"
                        data-id="${escapar(registro.id)}"
                        style="width: 100%;">
                        Ver detalles
                    </button>
                </div>
            </div>
        </div>
    `;
    }).join("");
}

const contenedorLista = $("ls");
if (contenedorLista) {
    contenedorLista.addEventListener("click", async evento => {
        const btnEliminar = evento.target.closest(".delete-device");
        const btnEditar = evento.target.closest(".edit-device");
        const btnVer = evento.target.closest(".view-device");
        const id = (btnEliminar || btnEditar || btnVer)?.dataset.id;
        if (!id) return;
        if (btnEliminar) {
            evento.preventDefault();
            if (!window.confirm(`¿Seguro que deseas eliminar el dispositivo ${id}?`)) {
                return;
            }
            try {
                await deleteDoc(doc(db, "repairs", id));
                try {
                    await deleteDoc(doc(db, "contacts", id));
                } catch (error) {
                    console.warn("No se pudo eliminar el contacto:", error);
                }
            } catch (error) {
                alert("No se pudo eliminar el dispositivo: " + error.message);
            }
            return;
        }
        if (btnEditar) {
            evento.preventDefault();
            abrirEdicion(id);
            return;
        }
        if (btnVer) {
            evento.preventDefault();
            window.location.href = `detalle.html?c=${encodeURIComponent(id)}`;
            return;
        }
    });
}

/* =========================
   NOTIFICACIÓN POR WHATSAPP
========================= */
async function enviarNotificacionCliente(codigo, nuevoEstado, nota) {
    try {
        const contSnap = await getDoc(doc(db, "contacts", codigo));
        if (!contSnap.exists()) return;
        
        const contacto = contSnap.data();
        const telefono = contacto.telefono || contacto.telefono2;
        if (!telefono) {
            alert("No hay un número de teléfono registrado para este cliente.");
            return;
        }
        const numeroLimpio = telefono.replace(/\D/g, "");
        const numeroCompleto = numeroLimpio.startsWith(CONFIG.prefijo) 
            ? numeroLimpio 
            : `${CONFIG.prefijo}${numeroLimpio}`;
            
        const mensajeTexto = `Hola ${contacto.cliente}, JS TECH le informa que el estado de su equipo (${codigo}) ha sido actualizado:\n\n Estado: ${nuevoEstado}\n Avance: ${nota}\n\nPuede ver el estado completo aquí:\n${enlaceCliente(codigo)}`;
        
        // 🚀 Enlace directo para abrir la app de WhatsApp en el celular al instante
        const urlWhatsapp = `whatsapp://send?phone=${numeroCompleto}&text=${encodeURIComponent(mensajeTexto)}`;
        
        window.location.href = urlWhatsapp;
    } catch (error) {
        console.error("Error al generar enlace de WhatsApp:", error);
    }
}

/* =========================
   DETALLES DEL DISPOSITIVO
========================= */
async function abrirDetalle(id, silencioso = false) {
    const miVersion = ++versionDetalle;
    const dt = $("dt");
    if (!dt) return;
    let registro = null;
    try {
        const docSnap = await getDoc(doc(db, "repairs", id));
        if (!docSnap.exists()) {
            dt.innerHTML = `<div class="message error">No se encontró el dispositivo especificado.</div>`;
            return;
        }
        registro = { id: docSnap.id, ...docSnap.data() };
    } catch (error) {
        console.error("Error al cargar dispositivo:", error);
        return;
    }
    let contacto = {
        cliente: "Cliente general",
        telefono: "",
        telefono2: "",
        correo: "",
        direccion: ""
    };
    try {
        const contSnap = await getDoc(doc(db, "contacts", id));
        if (contSnap.exists()) contacto = contSnap.data();
    } catch (error) {
        console.warn("No se pudo cargar el contacto:", error);
    }
    if (miVersion !== versionDetalle) return;
    const historial = Array.isArray(registro.historial)
        ? registro.historial
        : [];
    const tituloDetalle = $("tituloDetalle");
    if (tituloDetalle) {
        tituloDetalle.textContent = `Expediente: ${registro.id}`;
    }
    const detalleMarcaModelo = [registro.marca, registro.modelo]
        .filter(Boolean)
        .join(" ") || "No especificada";
    dt.innerHTML = `
        <article class="card detail-card">
            <div class="detail-heading">
                <div>
                    <span class="section-kicker">EXPEDIENTE TÉCNICO</span>
                    <h2>${escapar(registro.id)}</h2>
                    <p class="muted">${escapar(registro.tipo)} — ${escapar(detalleMarcaModelo)}</p>
                </div>
                <div class="badges-container">
                    ${insignia(registro.estado)}
                    ${insigniaPrioridad(registro.prioridad)}
                </div>
            </div>
            <div class="detail-actions">
                <button class="btn btn-secondary" id="btnImprimirDetalle" type="button">Imprimir ticket</button>
                <button class="btn btn-neutral" id="btnCopiarCodigo" type="button">Copiar código</button>
                <button class="btn btn-neutral" id="btnCopiarEnlace" type="button">Copiar enlace</button>
            </div>
            <div class="detail-meta">
                <div>
                    <p><strong>Cliente:</strong> ${escapar(contacto.cliente)}</p>
                    <p><strong>Teléfono 1:</strong> ${escapar(contacto.telefono || "No registrado")}</p>
                    <p><strong>Teléfono 2:</strong> ${escapar(contacto.telefono2 || "No registrado")}</p>
                    <p><strong>Correo:</strong> ${escapar(contacto.correo || "No registrado")}</p>
                    <p><strong>Dirección:</strong> ${escapar(contacto.direccion || "No registrada")}</p>
                </div>
                <div>
                    <p><strong>Marca / Modelo:</strong> ${escapar(detalleMarcaModelo)}</p>
                    <p><strong>Color:</strong> ${escapar(registro.color || "No especificado")}</p>
                    <p><strong>Serie:</strong> ${escapar(registro.serie || "No especificada")}</p>
                    <p><strong>Costo estimado:</strong> ₡${escapar(registro.costo || "0.00")}</p>
                    <p><strong>Ingreso:</strong> ${formatearFecha(registro.creado)}</p>
                    <p><strong>Última actualización:</strong> ${formatearFecha(registro.actualizado)}</p>
                    <p><strong>Problema reportado:</strong></p>
                    <p class="muted">${escapar(registro.problema)}</p>
                    <p><strong>Observaciones iniciales:</strong></p>
                    <p class="muted">${escapar(registro.observaciones || "Ninguna")}</p>
                </div>
            </div>
            <h3>Historial y progreso</h3>
            <div class="history">
                ${historial.map(h => `
                    <div class="history-item">
                        <strong>${escapar(h.estado)}</strong>${h.nota ? `<p style="margin:2px 0;">${escapar(h.nota)}</p>` : ""}
                        <small>${formatearFecha(h.fecha)}</small>
                    </div>
                `).join("")}
            </div>
            <!-- APARTADO DE FOTOGRAFÍAS (GOOGLE DRIVE) -->
            <section class="card" style="margin-top:24px;">
                <h3>📸 Fotos del dispositivo (Google Drive)</h3>
                <p class="muted">
                    Tomá o selecciona fotografías para subirlas directamente a Google Drive y compartirlas con el cliente.
                </p>
                <button class="btn btn-primary" type="button" id="abrirApartadoFotos">
                    📷 Abrir selector de imágenes
                </button>
                <div id="apartadoFotos" style="display:none;margin-top:20px;">
                    <label for="categoriaFoto">Tipo de fotografía</label>
                    <select id="categoriaFoto">
                        <option value="Estado inicial">Estado inicial</option>
                        <option value="En reparación">En reparación</option>
                        <option value="Trabajo terminado">Trabajo terminado</option>
                        <option value="Otra evidencia">Otra evidencia</option>
                    </select>
                    <label for="fotoCamara" style="margin-top:12px;">Tomar fotografía con cámara</label>
                    <input
                        type="file"
                        id="fotoCamara"
                        accept="image/*"
                        capture="environment"
                        multiple
                        class="photo-input"
                    >
                    <label for="fotoGaleria">Seleccionar desde la galería</label>
                    <input
                        type="file"
                        id="fotoGaleria"
                        accept="image/jpeg,image/png,image/webp"
                        multiple
                        class="photo-input"
                    >
                    <div id="vistaPreviaFotos" class="photo-gallery"></div>
                    <button class="btn btn-primary btn-full" type="button" id="guardarFotos" style="margin-top:16px;">
                        Subir fotografías a Google Drive
                    </button>
                    <p id="mensajeFotos" class="photo-status" aria-live="polite"></p>
                </div>
                <h3 style="margin-top:24px;">Galería en Google Drive</h3>
                <div id="galeriaFotos" class="photo-gallery"></div>
            </section>
            <form class="update-form" id="formActualizarEstado">
                <h4>Actualizar estado del equipo</h4>
                <div class="form-grid">
                    <div class="field">
                        <label for="nuevoEstado">Nuevo estado</label>
                        <select id="nuevoEstado" required>
                            ${ESTADOS.map(e => `
                                <option ${e === registro.estado ? "selected" : ""}>
                                    ${e}
                                </option>
                            `).join("")}
                        </select>
                    </div>
                    <div class="field">
                        <label for="notaEstado">Nota o avance</label>
                        <input id="notaEstado"
                               placeholder="Ej: Se reemplazó la pantalla con éxito..."
                               required>
                    </div>
                </div>
                <button class="btn btn-primary" type="submit" style="margin-top:12px;">
                    Guardar cambios
                </button>
            </form>
        </article>
    `;
    $("btnImprimirDetalle")?.addEventListener("click", () => {
        imprimirTicket(
            registro.id,
            registro,
            contacto.cliente,
            contacto.telefono,
            contacto.telefono2,
            contacto.correo,
            contacto.direccion
        );
    });
    $("btnCopiarCodigo")?.addEventListener("click", () => copiarTexto(registro.id));
    $("btnCopiarEnlace")?.addEventListener("click", () => copiarTexto(enlaceCliente(registro.id)));
    configurarFotosGoogleDrive(registro.id, registro.fotos || []);
    $("formActualizarEstado")?.addEventListener("submit", async ev => {
        ev.preventDefault();
        const nuevoEstado = $("nuevoEstado").value;
        const nota = $("notaEstado").value.trim();
        try {
            const ahora = Date.now();
            const nuevoHistorial = [
                ...(registro.historial || []),
                { estado: nuevoEstado, nota, fecha: ahora }
            ];
            await updateDoc(doc(db, "repairs", id), {
                estado: nuevoEstado,
                actualizado: ahora,
                historial: nuevoHistorial
            });
            await enviarNotificacionCliente(id, nuevoEstado, nota);
            alert("Estado actualizado correctamente.");
            abrirDetalle(id, true);
        } catch (error) {
            alert("No se pudo actualizar: " + error.message);
        }
    });
}

/* =========================
   FOTOGRAFÍAS CON GOOGLE DRIVE
========================= */
function configurarFotosGoogleDrive(codigo, fotosIniciales = []) {
    const abrir = $("abrirApartadoFotos");
    const apartado = $("apartadoFotos");
    const camara = $("fotoCamara");
    const galeria = $("fotoGaleria");
    const vista = $("vistaPreviaFotos");
    const guardar = $("guardarFotos");
    const mensaje = $("mensajeFotos");
    const galeriaGuardada = $("galeriaFotos");
    if (!abrir || !apartado || !camara || !galeria ||
        !vista || !guardar || !mensaje || !galeriaGuardada) {
        return;
    }
    let seleccionadas = [];
    let urlsTemporales = [];
    function limpiarPrevisualizaciones() {
        urlsTemporales.forEach(url => URL.revokeObjectURL(url));
        urlsTemporales = [];
        vista.innerHTML = "";
    }
    function dibujarPrevisualizaciones() {
        limpiarPrevisualizaciones();
        seleccionadas.forEach((archivo, indice) => {
            const url = URL.createObjectURL(archivo);
            urlsTemporales.push(url);
            const tarjeta = document.createElement("div");
            tarjeta.className = "photo-item";
            const imagen = document.createElement("img");
            imagen.src = url;
            imagen.alt = "Vista previa";
            const nombre = document.createElement("p");
            nombre.textContent = archivo.name;
            const quitar = document.createElement("button");
            quitar.type = "button";
            quitar.className = "btn btn-neutral";
            quitar.textContent = "Quitar";
            quitar.style.cssText = "margin-top:6px;width:100%;padding:6px;";
            quitar.addEventListener("click", () => {
                seleccionadas.splice(indice, 1);
                dibujarPrevisualizaciones();
                mensaje.textContent = `Imágenes seleccionadas: ${seleccionadas.length}`;
            });
            tarjeta.append(imagen, nombre, quitar);
            vista.appendChild(tarjeta);
        });
    }
    function agregarArchivos(archivos) {
        const permitidos = ["image/jpeg", "image/png", "image/webp"];
        let rechazados = 0;
        for (const archivo of archivos) {
            if (!permitidos.includes(archivo.type) || archivo.size > 10 * 1024 * 1024) {
                rechazados++;
                continue;
            }
            seleccionadas.push(archivo);
        }
        dibujarPrevisualizaciones();
        mensaje.textContent = rechazados
            ? `Se omitieron ${rechazados} archivo(s). Usa JPG, PNG o WEBP de máximo 10MB.`
            : `Imágenes seleccionadas: ${seleccionadas.length}`;
    }
    function dibujarGaleria(fotos) {
        const lista = Array.isArray(fotos) ? fotos : [];
        if (!lista.length) {
            galeriaGuardada.innerHTML = '<p class="muted">Todavía no hay fotografías en Google Drive para este equipo.</p>';
            return;
        }
        galeriaGuardada.innerHTML = lista.map((foto, indice) => {
            if (!foto || typeof foto.url !== "string") return "";
            const fechaFotoStr = formatearFecha(foto.fecha);
            return `
                <div class="photo-item">
                    <a href="${escapar(foto.url)}" target="_blank" rel="noopener noreferrer">
                        <img src="${escapar(foto.url)}" alt="${escapar(foto.categoria || "Foto")}" loading="lazy">
                    </a>
                    <p><strong>${escapar(foto.categoria || "Evidencia")}</strong></p>
                    <small class="muted" style="display:block;margin-top:2px;">📅 ${escapar(fechaFotoStr)}</small>
                    <button
                        type="button"
                        class="btn btn-neutral"
                        data-eliminar-foto="${indice}"
                        style="margin-top:8px;background:#fee2e2;color:#b91c1c;border:0;width:100%;font-size:11px;"
                    >
                        🗑 Eliminar de la lista
                    </button>
                </div>
            `;
        }).join("");
    }
    abrir.addEventListener("click", () => {
        const cerrado = apartado.style.display === "none";
        apartado.style.display = cerrado ? "block" : "none";
        abrir.textContent = cerrado ? "✖ Cerrar selector" : "📷 Abrir selector de imágenes";
    });
    camara.addEventListener("change", () => {
        agregarArchivos(Array.from(camara.files || []));
        camara.value = "";
    });
    galeria.addEventListener("change", () => {
        agregarArchivos(Array.from(galeria.files || []));
        galeria.value = "";
    });
    dibujarGaleria(fotosIniciales);
    guardar.addEventListener("click", async () => {
        if (!seleccionadas.length) {
            mensaje.textContent = "Primero selecciona al menos una fotografía.";
            return;
        }
        const categoria = $("categoriaFoto").value;
        const archivos = [...seleccionadas];
        guardar.disabled = true;
        guardar.textContent = "Subiendo a Google Drive...";
        mensaje.textContent = "Subiendo imágenes a tu Drive. Por favor espera...";
        const fotosSubidas = [];
        try {
            for (let i = 0; i < archivos.length; i++) {
                const archivo = archivos[i];
                mensaje.textContent = `Subiendo foto ${i + 1} de ${archivos.length} a Google Drive...`;
                const base64 = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = error => reject(error);
                    reader.readAsDataURL(archivo);
                });
                const respuesta = await fetch(URL_GOOGLE_DRIVE, {
                    method: "POST",
                    body: JSON.stringify({
                        file: base64,
                        filename: `${codigo}_${Date.now()}_${archivo.name}`
                    })
                });
                const resultado = await respuesta.json();
                if (resultado.status === "success") {
                    fotosSubidas.push({
                        url: resultado.url,
                        nombre: archivo.name,
                        categoria,
                        fecha: Date.now()
                    });
                } else {
                    throw new Error(resultado.message || "Error al subir a Google Drive");
                }
            }
            await updateDoc(doc(db, "repairs", codigo), {
                fotos: arrayUnion(...fotosSubidas),
                actualizado: Date.now()
            });
            seleccionadas = [];
            limpiarPrevisualizaciones();
            mensaje.textContent = "¡Fotos subidas con éxito a Google Drive y guardadas!";
            const actualizado = await getDoc(doc(db, "repairs", codigo));
            if (actualizado.exists()) {
                dibujarGaleria(actualizado.data().fotos || []);
            }
        } catch (error) {
            console.error("Error al subir a Google Drive:", error);
            mensaje.textContent = "No se pudieron subir las fotos: " + error.message;
        } finally {
            guardar.disabled = false;
            guardar.textContent = "Subir fotografías a Google Drive";
        }
    });
    galeriaGuardada.addEventListener("click", async evento => {
        const boton = evento.target.closest("[data-eliminar-foto]");
        if (!boton) return;
        const indice = Number(boton.dataset.eliminarFoto);
        if (!Number.isInteger(indice) || indice < 0) return;
        if (!confirm("¿Deseas quitar esta fotografía del expediente?")) return;
        try {
            const resultado = await getDoc(doc(db, "repairs", codigo));
            if (!resultado.exists()) return;
            const fotos = resultado.data().fotos || [];
            const fotosRestantes = fotos.filter((_, i) => i !== indice);
            await updateDoc(doc(db, "repairs", codigo), {
                fotos: fotosRestantes,
                actualizado: Date.now()
            });
            dibujarGaleria(fotosRestantes);
        } catch (error) {
            alert("No se pudo actualizar la lista: " + error.message);
        }
    });
}

/* =========================
   EDITAR DISPOSITIVO Y CONTACTO
========================= */
async function abrirEdicion(id) {
    const registro = dispositivos.find(r => r.id === id);
    if (!registro) return;
    let contacto = {
        cliente: "",
        telefono: "",
        telefono2: "",
        correo: "",
        direccion: ""
    };
    try {
        const contSnap = await getDoc(doc(db, "contacts", id));
        if (contSnap.exists()) {
            contacto = contSnap.data();
        }
    } catch (error) {
        console.warn("No se pudo cargar el contacto para editar:", error);
    }
    const dt = $("dt");
    if (!dt) return;
    dt.innerHTML = `
        <article class="card edit-card">
            <div class="section-heading">
                <div>
                    <span class="section-kicker">MODIFICAR DATOS</span>
                    <h2>Editar dispositivo</h2>
                    <p class="muted" style="margin-top:4px;">
                        <strong>${escapar(registro.marca || "")} ${escapar(registro.modelo || "")}</strong><br>
                        Serie: ${escapar(registro.serie || "Sin número de serie")}
                    </p>
                </div>
            </div>
            <form id="formEdicao">
                <div class="form-grid">
                    <div class="field">
                        <label for="e_cli">Nombre del cliente</label>
                        <input id="e_cli" value="${escapar(contacto.cliente || "")}" required>
                    </div>
                    <div class="field">
                        <label for="e_mar">Marca *</label>
                        <input id="e_mar" value="${escapar(registro.marca || "")}" required>
                    </div>
                    <div class="field">
                        <label for="e_mod">Modelo*</label>
                        <input id="e_mod" value="${escapar(registro.modelo || "")}" required>
                    </div>
                    <div class="field">
                        <label for="e_col">Color</label>
                        <input id="e_col" value="${escapar(registro.color || "")}">
                    </div>
                    <div class="field">
                        <label for="e_ser">Serie*</label>
                        <input id="e_ser" value="${escapar(registro.serie || "")}" required>
                    </div>
                    <div class="field">
                        <label for="e_tel">Teléfono 1</label>
                        <input id="e_tel" type="tel" value="${escapar(contacto.telefono || "")}" maxlength="25">
                    </div>
                    <div class="field">
                        <label for="e_cos">Costo estimado (₡)</label>
                        <input id="e_cos" type="number" min="0" step="0.01"
                               value="${escapar(registro.costo || "")}">
                    </div>
                    <div class="field">
                        <label for="e_prio">Prioridad *</label>
                        <select id="e_prio" required>
                            <option value="Normal" ${registro.prioridad === "Normal" ? "selected" : ""}>Normal</option>
                            <option value="Urgente" ${registro.prioridad === "Urgente" ? "selected" : ""}>Urgente</option>
                        </select>
                    </div>
                </div>
                <div class="field" style="margin-top:12px;">
                    <label for="e_pro">Problema reportado *</label>
                    <textarea id="e_pro" rows="3" required>${escapar(registro.problema)}</textarea>
                </div>
                <div class="field" style="margin-top:12px;">
                    <label for="e_obs">Observaciones iniciales *</label>
                    <textarea id="e_obs" rows="3" required>${escapar(registro.observaciones || "")}</textarea>
                </div>
                <div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap;">
                    <button class="btn btn-primary" type="submit">Guardar cambios</button>
                    <button class="btn btn-neutral" type="button" id="cancelarEdicion">Cancelar</button>
                </div>
            </form>
        </article>
    `;
    $("cancelarEdicion").addEventListener("click", () => {
        if (window.location.pathname.includes("detalle.html")) {
            window.location.href = "dispositivos.html";
        } else {
            const dtEl = $("dt");
            if (dtEl) dtEl.innerHTML = "";
        }
    });
    $("formEdicao").addEventListener("submit", async ev => {
        ev.preventDefault();
        const marcaEditada = $("e_mar").value.trim();
        const modeloEditado = $("e_mod").value.trim();
        const serieEditada = $("e_ser").value.trim();
        const obsEditadas = $("e_obs").value.trim();
        if (!marcaEditada || !modeloEditado || !serieEditada || !obsEditadas) {
            alert("Los campos Marca, Modelo, Serie y Observaciones iniciales son obligatorios.");
            return;
        }
        try {
            const ahora = Date.now();
            await updateDoc(doc(db, "repairs", id), {
                marca: marcaEditada,
                modelo: modeloEditado,
                color: $("e_col").value.trim(),
                serie: serieEditada,
                costo: $("e_cos").value.trim(),
                prioridad: $("e_prio").value,
                problema: $("e_pro").value.trim(),
                observaciones: obsEditadas,
                actualizado: ahora
            });
            const nuevoCliente = $("e_cli").value.trim();
            const nuevoTelefono = $("e_tel").value.trim();
            
            await updateDoc(doc(db, "contacts", id), {
                cliente: nuevoCliente,
                telefono: nuevoTelefono
            });
            alert("Dispositivo y contacto actualizados con éxito.");
            
            if (window.location.pathname.includes("detalle.html")) {
                abrirDetalle(id, true);
            } else {
                const dtEl = $("dt");
                if (dtEl) dtEl.innerHTML = "";
            }
        } catch (error) {
            alert("Error al actualizar: " + error.message);
        }
    });
}

/* =========================
   IMPRIMIR TICKET
========================= */
function imprimirTicket(codigo, registro, cliente, telefono, telefono2, correo, direccion) {
    const ventanaImpresion = window.open("", "_blank");
    if (!ventanaImpresion) {
        alert("Por favor, permite las ventanas emergentes para imprimir el ticket.");
        return;
    }
    const fechaIngreso = formatearFecha(registro.creado);
    ventanaImpresion.document.write(`
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <title>Comprobante - ${escapar(codigo)}</title>
            <style>
                @page {
                    size: portrait;
                    margin: 6mm;
                }
                body {
                    font-family: Arial, sans-serif;
                    font-size: 12px;
                    color: #000;
                    margin: 0;
                    padding: 0;
                }
                .ticket-container {
                    display: flex;
                    flex-direction: column;
                    gap: 14px;
                    width: 100%;
                    box-sizing: border-box;
                }
                .bloque-seccion {
                    width: 100%;
                    box-sizing: border-box;
                    padding: 14px;
                    border: 2px solid #2b5797;
                    border-radius: 8px;
                    page-break-inside: avoid;
                }
                .bloque-codigo {
                    width: 100%;
                    text-align: center;
                    background: #eef4ff;
                    border: 2px solid #2b5797;
                    border-radius: 8px;
                    padding: 10px;
                    page-break-inside: avoid;
                }
                .codigo-destacado {
                    font-size: 32px;
                    font-weight: 800;
                    letter-spacing: 4px;
                    color: #2b5797;
                    margin: 4px 0;
                }
                .header-ticket {
                    text-align: center;
                    margin-bottom: 10px;
                }
                .header-ticket h2 {
                    margin: 0;
                    font-size: 18px;
                    color: #2b5797;
                }
                .header-ticket p {
                    margin: 2px 0;
                    font-size: 10px;
                    color: #555;
                }
                h3 {
                    text-align: center;
                    font-size: 12px;
                    margin: 8px 0;
                    color: #2b5797;
                    text-decoration: underline;
                }
                table {
                    width: 100%;
                    border-collapse: collapse;
                    margin-bottom: 8px;
                }
                th, td {
                    border: 1px solid #2b5797;
                    padding: 6px 8px;
                    font-size: 11px;
                    text-align: left;
                }
                th {
                    background-color: #2b5797;
                    color: white;
                    text-align: center;
                    font-size: 11.5px;
                }
                .seccion-tabla {
                    height: 60px;
                    vertical-align: top;
                }
                .politicas ol {
                    padding-left: 18px;
                    margin: 4px 0;
                }
                .politicas li {
                    font-size: 9px;
                    margin-bottom: 3px;
                    text-align: justify;
                }
                .firmas {
                    display: flex;
                    justify-content: space-between;
                    margin-top: 25px;
                    font-size: 11px;
                }
                .firma-linea {
                    width: 45%;
                    border-top: 1px solid #2b5797;
                    text-align: center;
                    padding-top: 4px;
                    color: #2b5797;
                    font-weight: bold;
                }
                .footer-ticket {
                    margin-top: 6px;
                    font-size: 9px;
                    text-align: center;
                    border-top: 1px solid #2b5797;
                    padding-top: 4px;
                    color: #555;
                }
                @media print {
                    body {
                        padding: 0;
                    }
                }
            </style>
        </head>
        <body onload="window.print(); window.close();">
            <div class="ticket-container">
                
                <!-- BLOQUE 1: DATOS GENERALES Y DEL EQUIPO -->
                <div class="bloque-seccion">
                    <div class="header-ticket">
                        <h2>JS TECH</h2>
                        <p>Frente al Hotel Cañas. Cañas, Guanacaste | Teléfono +506 8638 9553 | Cédula física # 5 0395 0104</p>
                    </div>
                    <table>
                        <tr>
                            <th colspan="2">DATOS GENERALES</th>
                        </tr>
                        <tr>
                            <td><strong>Nombre:</strong> ${escapar(cliente)}</td>
                            <td><strong>Fecha de ingreso:</strong> ${escapar(fechaIngreso)}</td>
                        </tr>
                        <tr>
                            <td><strong>Teléfono 1:</strong> ${escapar(telefono || "No registrado")}</td>
                            <td><strong>Teléfono 2:</strong> ${escapar(telefono2 || "No registrado")}</td>
                        </tr>
                        <tr>
                            <td colspan="2"><strong>Correo electrónico:</strong> ${escapar(correo || "No registrado")}</td>
                        </tr>
                        <tr>
                            <td colspan="2"><strong>Dirección:</strong> ${escapar(direccion || "No registrada")}</td>
                        </tr>
                    </table>
                    <table>
                        <tr>
                            <th colspan="4">DATOS DEL EQUIPO</th>
                        </tr>
                        <tr>
                            <td><strong>Marca:</strong> ${escapar(registro.marca || "N/A")}</td>
                            <td><strong>Modelo:</strong> ${escapar(registro.modelo || "N/A")}</td>
                            <td><strong>Tipo:</strong> ${escapar(registro.tipo)}</td>
                            <td><strong>Color:</strong> ${escapar(registro.color || "N/A")}</td>
                        </tr>
                        <tr>
                            <td colspan="2"><strong>Serie:</strong> ${escapar(registro.serie || "N/A")}</td>
                            <td colspan="2"><strong>Costo Estimado:</strong> ₡${escapar(registro.costo || "0.00")}</td>
                        </tr>
                        <tr>
                            <td colspan="4" class="seccion-tabla"><strong>Problema reportado / Comentario Usuario:</strong><br>${escapar(registro.problema)}</td>
                        </tr>
                        <tr>
                            <td colspan="4" class="seccion-tabla"><strong>Observaciones iniciales:</strong><br>${escapar(registro.observaciones || "Ninguna")}</td>
                        </tr>
                        
                    </table>
                    <div class="footer-ticket">
                        <p>ventasjystechnology@gmail.com</p>
                    </div>
                </div>
                <!-- BLOQUE 2: CÓDIGO GRANDE Y CENTRADO -->
                <div class="bloque-codigo">
                    <span style="font-size: 11px; font-weight: bold; color: #2b5797; text-transform: uppercase;">Código de Seguimiento</span>
                    <div class="codigo-destacado">${escapar(codigo)}</div>
                </div>
                <!-- BLOQUE 3: POLÍTICAS Y FIRMAS -->
                <div class="bloque-seccion">
                    <div class="header-ticket">
                        <h2>JS TECH</h2>
                        <p>Frente al Hotel Cañas. Cañas, Guanacaste | Teléfono +506 8638 9553 | Cédula física # 5 0395 0104</p>
                    </div>
                    <h3>Políticas de JS TECH:</h3>
                    
                    <div class="politicas">
                        <ol>
                            <li>Cada equipo se evaluará primero antes de proceder a realizar alguna instalación, reparación, mantenimiento u otros. Una vez se determine las acciones a realizar, se contactará al cliente para analizar costos y otros.</li>
                            <li>Una vez ingresado el equipo a taller y entregado este documento, el cliente aprueba que se realice mantenimiento o reparación durante la revisión, si fuese necesario, para determinar el funcionamiento del mismo, aunque no se haya contactado al propietario primero. Se entiende que cada trabajo, sea mantenimiento o reparación durante o posterior a la revisión, reflejara los costos en los misceláneos de la factura final.</li>
                            <li>La revisión de computadoras, tanto laptops como de escritorio, es gratuita, siempre y cuando no se realice ninguna reparación, mantenimiento, diagnóstico por escrito y/o comprobación de partes durante o posterior a la misma.</li>
                            <li>Toda revisión en impresoras tendrá un valor inicial de ₡5.000, monto que será rebajado en el valor final de la reparación.</li>
                            <li>Una vez que el equipo ingrese al establecimiento se acordará entre ambas partes los plazos correspondientes a revisión, eventual reparación, mantenimiento o instalación, fecha y hora de entrega.</li>
                            <li>JS TECH no se hace responsable por daños (previos al ingreso) provocados por terceros, o daños que surjan en el tiempo de estadía del equipo en la tienda causados por mala manipulación del usuario o terceros, ni por tiempo excedido adecuado para intervenir el equipo.</li>
                            <li>Una vez acordado el tiempo de entrega o se notifique que el equipo se encuentra listo para ser retirado, el propietario contará con seis meses para hacer efectivo el retiro. Caso contrario, el equipo pasará a manos de JS TECH para ser procesado según estado final del equipo; ya sea, dado de baja o asignado a disposición del taller para cubrir gastos de bodegaje, misceláneos o trabajos realizados. En caso de ser necesario, se extenderá un plazo adicional, el cual, se establecerá a criterio de la administración y propietario.</li>
                            <li>Al ingresar el equipo a taller, el cliente está de acuerdo en que se utilice material promocional generado durante la intervención del equipo para redes sociales, afiches y otro (contenido tal como imágenes, videos, audios, entre otros) con el objetivo de promocionar el trabajo realizado por nuestra empresa sin que se revele o filtre información sensible y personal del usuario.</li>
                            <li>Nos reservamos el derecho de admisión.</li>
                        </ol>
                    </div>
                    <div class="firmas">
                        <div class="firma-linea">
                            Recibe: Jorge Villalobos Barrera
                        </div>
                        <div class="firma-linea">
                            Entrega:
                        </div>
                    </div>
                    <div class="footer-ticket" style="margin-top: 10px;">
                        <p>ventasjystechnology@gmail.com</p>
                    </div>
                </div>
            </div>
        </body>
        </html>
    `);
    ventanaImpresion.document.close();
}

/* =========================
   INICIALIZADOR PARA DETALLE.HTML
========================= */
document.addEventListener("DOMContentLoaded", () => {
    const params = new URLSearchParams(window.location.search);
    const codigoEquipo = params.get("c");
    if (codigoEquipo && window.location.pathname.includes("detalle.html")) {
        onAuthStateChanged(auth, usuario => {
            if (usuario) {
                abrirDetalle(codigoEquipo, false);
            } else {
                window.location.href = "dispositivos.html";
            }
        });
    }
});