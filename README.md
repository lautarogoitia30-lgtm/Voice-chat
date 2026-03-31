# VoiceSpace - Aplicación de Chat de Voz

> 🎤 VoiceSpace es una aplicación de chat de voz similar a Discord, desarrollada con Python (FastAPI) y LiveKit para comunicaciones de voz en tiempo real.

## 🚀 Estado del Proyecto

**Producción:** https://voice-chat-production-a794.up.railway.app

## 📋 Características

- ✅ **Chat de Voz en Tiempo Real** - Comunicación de voz usando LiveKit
- ✅ **Canales de Voz y Texto** - Organización en grupos y canales
- ✅ **Participantes Visibles** - Ver quién está en voz aunque no estés ahí
- ✅ **Control de Volumen** - Ajuste de volumen de entrada/salida
- ✅ **Mute/Unmute** - Silenciar micrófono funciona correctamente
- ✅ **Configuración de Audio** - Supresión de ruido y cancelación de eco
- ✅ **Base de Datos Persistente** - PostgreSQL en Railway
- ✅ **Tema Visual** - Estilo pastel rosa inspirado en Discord

## 🛠️ Stack Tecnológico

### Backend
- **Python 3.12** con FastAPI
- **SQLAlchemy** (async) + PostgreSQL
- **LiveKit** para voice chat
- **Uvicorn** como servidor ASGI
- **Railway** para deployment

### Frontend
- **HTML/CSS/JS** vanilla
- **LiveKit Client** para WebRTC
- **WebSocket** para mensajería en tiempo real

## 📁 Estructura del Proyecto

```
Voice-Chat/
├── backend/
│   ├── main.py              # Punto de entrada FastAPI
│   ├── database.py         # Configuración de base de datos
│   ├── models.py           # Modelos SQLAlchemy
│   ├── routes/
│   │   ├── auth.py         # Autenticación (login/register)
│   │   ├── groups.py       # Gestión de grupos
│   │   ├── channels.py     # Gestión de canales
│   │   ├── livekit.py      # Tokens de LiveKit
│   │   └── files.py        # Subida de archivos
│   └── requirements.txt     # Dependencias Python
│
├── frontend/
│   ├── index.html          # Frontend principal
│   ├── css/
│   │   └── styles.css      # Estilos CSS
│   ├── js/
│   │   ├── api.js          # Cliente API
│   │   ├── app.js          # Lógica de la app
│   │   ├── livekit.js      # Cliente de voz
│   │   └── websocket.js    # WebSocket cliente
│   └── assets/
│       └── logo.png        # Logo de VoiceSpace
│
├── .env                    # Variables de entorno locales
├── Procfile                # Comando de inicio Railway
├── runtime.txt            # Versión de Python
└── README.md              # Este archivo
```

## 🔧 Configuración para Desarrollo Local

### Prerrequisitos
- Python 3.12+
- Node.js (opcional, para desarrollo frontend)
- PostgreSQL (opcional, por defecto usa SQLite)

### Instalación

```bash
# 1. Clonar el repositorio
git clone https://github.com/tu-usuario/Voice-Chat.git
cd Voice-Chat

# 2. Crear entorno virtual
python -m venv venv
source venv/bin/activate  # Linux/Mac
# O en Windows:
venv\Scripts\activate

# 3. Instalar dependencias
pip install -r requirements.txt

# 4. Configurar variables de entorno
cp .env.example .env
# Editar .env con tus configuraciones

# 5. Iniciar el servidor
uvicorn backend.main:app --reload
```

### Variables de Entorno

```env
# Backend
DATABASE_URL=sqlite+aiosqlite:///./voice_chat.db
# O para PostgreSQL:
# DATABASE_URL=postgresql+asyncpg://user:pass@localhost:5432/voicespace

# LiveKit (obtener de livekit.io)
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your_api_key
LIVEKIT_API_SECRET=your_api_secret

# JWT Secret
JWT_SECRET=tu-secret-key-aqui

# Frontend URL (para CORS)
FRONTEND_URL=http://localhost:5500
```

## 🚢 Deployment en Railway

### Pasos para Deploy

1. **Crear proyecto en Railway**
   - Ir a https://railway.com
   - Crear nuevo proyecto (Empty)
   - Agregar servicio PostgreSQL

2. **Configurar variables en Railway**
   
   Para el servicio Python (backend):
   ```
   DATABASE_URL=postgresql+asyncpg://postgres:password@postgres.railway.internal:5432/railway
   LIVEKIT_URL=wss://your-livekit.cloud
   LIVEKIT_API_KEY=tu-api-key
   LIVEKIT_API_SECRET=tu-secret
   JWT_SECRET=una-clave-secreta-segura
   ```

3. **Conectar GitHub**
   - Railway detectará automáticamente Python del `runtime.txt`
   - Hará `pip install -r requirements.txt`
   - Ejecutará el `Procfile`

### Configuración de Railway

- **Builder:** Nixpacks (auto-detectado)
- **Start Command:** `uvicorn backend.main:app --host 0.0.0.0 --port $PORT`

## 🔐 Credenciales de Prueba

```
Usuario: Lauti
Contraseña: password123

Usuario: Mr.porteño
Contraseña: password123
```

## 🎛️ Configuración de Audio

### Configuración del Navegador

VoiceSpace usa el procesamiento de audio nativo del navegador:

1. **Supresión de Ruido** - Reduce ruido de fondo (teclado, mouse)
2. **Cancelación de Eco** - Elimina eco y retroalimentación
3. **Control de Ganancia Automática** - Ajusta niveles automáticamente

### Ajustes Aplicados Automáticamente

- **Reducción de volumen:** 85% para reducir sensibilidad del micrófono
- Esto ayuda a que el ruido del teclado no sea tan prominente

### Limitaciones del Navegador

El procesamiento de audio en el navegador tiene limitaciones. Discord y otras apps de escritorio usan procesamiento de audio del lado del servidor con IA, que es mucho más potente.

**Solución planificada:** Crear app de escritorio con Electron para acceso a APIs de audio nativas del sistema operativo.

## 🔧 API Endpoints

### Autenticación
```
POST /auth/register - Registrar usuario
POST /auth/login    - Iniciar sesión
GET  /users/me      - Obtener perfil
```

### Grupos
```
GET    /groups           - Listar grupos del usuario
POST   /groups           - Crear grupo
GET    /groups/{id}      - Obtener grupo
POST   /groups/{id}/invite - Invitar usuario
```

### Canales
```
GET  /groups/{group_id}/channels     - Listar canales
POST /groups/{group_id}/channels     - Crear canal
POST /channels/{channel_id}/voice    - Unirse a voz
DELETE /channels/{channel_id}/voice   - Salir de voz
GET  /channels/{channel_id}/voice/participants - Ver participantes
```

### LiveKit
```
GET /livekit/token?channel_id=X - Obtener token de voz
```

## 📊 Funcionalidades de Voz

### Unirse a un Canal de Voz
1. Seleccionar grupo → seleccionar canal de voz
2. Click en "Unirse"
3. El navegador pedirá permisos de micrófono
4. Listo - comunicación de voz activa

### Mute/Unmute
- Click en el botón de mute para silenciar
- El mute funciona correctamente (silencia completamente el audio)

### Ver Participantes
- Los participantes se muestran en la lista
- Los participantes se guardan en la base de datos
- Se pueden ver incluso cuando no estás en el canal de voz

## 🎨 Tema Visual

### Colores Principales
- **Rosa Pastel:** #F472B6 (principal)
- **Gris Oscuro:** #1a1a1a (fondos)
- **Gris Medio:** #2d2d2d (cards)
- **Blanco:** #ffffff (texto)

### Características
- Iconos de FontAwesome
- Transiciones suaves
- Botones con efectos hover
- Diseño responsivo

## 🐛 Solución de Problemas

### "LiveKit client not loaded"
- Hacer Ctrl+Shift+R para forzar refresh
- Verificar que el script de livekit.js carga correctamente

### Error al unirse a voz
- Verificar permisos del micrófono en el navegador
- Verificar conexión a Internet
- Revisar consola (F12) para errores

### No se guardan los settings de audio
- Verificar que localStorage está habilitado
- Los settings se guardan automáticamente

### Ruido de teclado muy fuerte
-盡量使用較好的麥克風
- Ajustar volumen de entrada más bajo
- Usar cancelación de ruido del navegador

## 🔜 Roadmap

- [ ] Crear app de escritorio con Electron
- [ ] Implementar噪声 cancellation avanzado
- [ ] Soporte para video
- [ ] Compartir pantalla
- [ ] Modo push-to-talk
- [ ] Indicadores de quién está hablando

## 📄 Licencia

MIT License

## 👤 Autor

Desarrollado por el equipo de VoiceSpace