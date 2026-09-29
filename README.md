# MACHINE BACKEND

## Plataforma tecnológica para sistemas industriales, comunicación y servicios digitales

**MACHINE BACKEND** es el núcleo de servicios de la plataforma MACHINE.

Este proyecto proporciona la infraestructura de servidor necesaria para conectar el frontend de MACHINE con los servicios de datos, autenticación, comunicación en tiempo real, almacenamiento de archivos y soporte de la plataforma.

MACHINE está concebido como una plataforma tecnológica orientada a entornos industriales y equipos de envasado y empaquetado, combinando información operacional, comunicación entre usuarios y servicios digitales dentro de una misma experiencia.

---

## MACHINE

MACHINE es una plataforma tecnológica diseñada para integrar:

- Sistemas industriales.
- Equipos y máquinas de envasado.
- Comunicación entre operadores.
- Usuarios y perfiles.
- Mensajería.
- Presencia en tiempo real.
- Intercambio de archivos.
- Servicios de soporte.
- Persistencia de información.

El backend constituye la capa de servicios que permite que estas funciones puedan operar de forma centralizada y conectada con el frontend.

---

# MACHINE BACKEND

El backend funciona como una API y servidor central para MACHINE.

Su responsabilidad principal es procesar solicitudes, validar información, comunicarse con la base de datos, administrar sesiones y usuarios, proporcionar comunicación en tiempo real y gestionar diferentes servicios utilizados por el frontend.

### Responsabilidades principales

- API REST.
- Gestión de usuarios.
- Gestión de perfiles.
- Autenticación.
- Comunicación con PostgreSQL.
- Integración con Supabase PostgreSQL.
- Chat.
- Mensajería privada.
- Presencia de usuarios en tiempo real.
- Socket.IO.
- Gestión de archivos.
- Sistema de uploads.
- Solicitudes de soporte.
- Envío de correos electrónicos.
- Persistencia de información.
- Servicios necesarios para MACHINE WEB.

---

# ARQUITECTURA GENERAL


                         MACHINE
                            │
             ┌──────────────┴──────────────┐
             │                             │
             ▼                             ▼
      MACHINE WEB                   MACHINE BACKEND
      Frontend React                 Node.js + Express
             │                             │
             │                             ├── API REST
             │                             ├── Socket.IO
             │                             ├── Autenticación
             │                             ├── Usuarios
             │                             ├── Chat
             │                             ├── Uploads
             │                             └── Email
             │
             └──────────────┬──────────────┘
                            │
                            ▼
                    PostgreSQL / Supabase


---

# TECNOLOGÍAS

MACHINE BACKEND utiliza un conjunto de tecnologías orientadas a proporcionar una infraestructura moderna y escalable.

### Backend

- Node.js
- Express.js
- JavaScript

### Base de datos

- PostgreSQL
- Supabase PostgreSQL

### Comunicación en tiempo real

- Socket.IO

### Comunicación HTTP

- REST API
- HTTP / HTTPS

### Archivos

- Sistema de uploads
- Gestión de archivos multimedia

### Correo electrónico

- Nodemailer
- SMTP / Gmail

### Configuración

- dotenv
- Variables de entorno

### Desarrollo

- Nodemon
- npm

---

# FUNCIONES PRINCIPALES

## API REST

El backend proporciona endpoints HTTP utilizados por MACHINE WEB para comunicarse con los servicios del servidor.

Estos endpoints permiten realizar operaciones relacionadas con:

- Usuarios.
- Autenticación.
- Perfiles.
- Chat.
- Conversaciones.
- Mensajes.
- Soporte.
- Archivos.
- Otros servicios internos de MACHINE.

---

# AUTENTICACIÓN

MACHINE BACKEND participa en el proceso de autenticación de usuarios.

La arquitectura permite:

- Registro de usuarios.
- Inicio de sesión.
- Validación de credenciales.
- Gestión de identidad.
- Protección de recursos privados.
- Identificación del usuario conectado.
- Comunicación autenticada con el frontend.

Las credenciales y secretos utilizados por el servidor se mantienen fuera del código fuente mediante variables de entorno.

---

# USUARIOS Y PERFILES

El backend administra la información necesaria para representar a los usuarios de MACHINE.

Entre los datos utilizados por la plataforma se encuentran elementos como:

- Identificación del usuario.
- Nombre.
- Apellido.
- Correo electrónico.
- Identificador de empleado.
- Perfil.
- Rol.
- Estado.
- Fotografía de perfil.
- Información relacionada con la actividad del usuario.

La información persistente se almacena en PostgreSQL.

---

# CHAT

MACHINE BACKEND proporciona los servicios necesarios para el sistema de comunicación de MACHINE.

El sistema contempla:

- Chat.
- Temas de conversación.
- Usuarios conectados.
- Mensajería privada.
- Conversaciones privadas.
- Persistencia de mensajes.
- Comunicación en tiempo real.
- Notificaciones relacionadas con mensajes.

---

# SOCKET.IO

Socket.IO permite establecer comunicación bidireccional en tiempo real entre MACHINE WEB y MACHINE BACKEND.

Actualmente se utiliza para funciones como:

- Presencia de usuarios.
- Usuarios conectados.
- Registro de sockets.
- Mensajería privada.
- Eventos de comunicación.
- Notificaciones en tiempo real.

La arquitectura permite que un evento generado por un usuario pueda ser comunicado inmediatamente al usuario correspondiente sin depender exclusivamente de solicitudes HTTP tradicionales.

---

# PRESENCIA EN TIEMPO REAL

El backend mantiene la comunicación necesaria para conocer el estado de conexión de los usuarios.

Esto permite que MACHINE pueda representar información como:


● Usuario conectado
○ Usuario desconectado


La presencia se comunica mediante Socket.IO.

---

# MENSAJERÍA PRIVADA

MACHINE incluye comunicación privada entre usuarios.

El backend proporciona la infraestructura necesaria para:

- Crear conversaciones privadas.
- Enviar mensajes.
- Persistir mensajes.
- Identificar remitentes y destinatarios.
- Comunicar mensajes mediante Socket.IO.
- Mantener información relacionada con lectura y entrega.
- Recuperar conversaciones desde la base de datos.

La persistencia permite que las conversaciones puedan ser recuperadas posteriormente.

---

# ARCHIVOS Y MULTIMEDIA

El backend dispone de infraestructura para gestionar archivos enviados desde MACHINE WEB.

El sistema contempla la recepción y almacenamiento de archivos asociados a las funcionalidades de comunicación.

Entre los tipos de contenido contemplados por la plataforma se encuentran:

- Imágenes.
- Vídeos.
- Audio.
- Archivos.

La gestión definitiva de cada tipo de contenido depende del endpoint y del flujo correspondiente dentro de la aplicación.

---

# SISTEMA DE UPLOADS

MACHINE BACKEND dispone de un sistema de uploads utilizado para recibir archivos enviados por el frontend.

Los archivos se gestionan desde el servidor y pueden estar relacionados con:

- Fotografías de perfil.
- Contenido multimedia.
- Archivos compartidos.
- Recursos utilizados por determinadas funcionalidades de MACHINE.

Los archivos y secretos de configuración no deben incorporarse al repositorio de código cuando contengan información privada.

---

# BASE DE DATOS

MACHINE BACKEND utiliza PostgreSQL como sistema principal de persistencia.

La infraestructura actual utiliza PostgreSQL mediante Supabase.

La base de datos almacena información relacionada con diferentes componentes de la plataforma, incluyendo:

- Usuarios.
- Perfiles.
- Chat.
- Conversaciones.
- Mensajes.
- Temas.
- Solicitudes de soporte.
- Información relacionada con la plataforma.

La conexión se configura mediante variables de entorno.

---

# ESTRUCTURA DEL PROYECTO

La estructura principal del backend se organiza de la siguiente manera:


machine-backend/
│
├── database/
│
├── src/
│   │
│   ├── ...
│   │
│   └── server.js
│
├── uploads/
│
├── .env
├── .gitignore
├── package.json
├── package-lock.json
├── README.md
│
└── archivos auxiliares de desarrollo


La carpeta `src` contiene la implementación principal del servidor.

La carpeta `database` contiene recursos relacionados con la estructura y mantenimiento de la base de datos.

La carpeta `uploads` está destinada a los archivos gestionados por el sistema.

---

# VARIABLES DE ENTORNO

MACHINE BACKEND utiliza variables de entorno para separar la configuración sensible del código fuente.

El archivo local:


.env


contiene información privada necesaria para ejecutar determinados servicios.

Por seguridad:


.env


**NO debe publicarse en GitHub.**

Las credenciales de:

- Base de datos.
- Servicios externos.
- Correo electrónico.
- Claves privadas.
- Tokens.
- Contraseñas.

deben mantenerse exclusivamente como secretos de entorno.

---

# ARCHIVO .GITIGNORE

El proyecto incluye un `.gitignore` para evitar que información sensible o archivos innecesarios sean incorporados al repositorio.

Entre los elementos protegidos se encuentran:


node_modules/
.env
.env.*
npm-debug.log*
.DS_Store


Esto permite mantener separado el código fuente de las credenciales privadas y archivos generados localmente.

---

# INSTALACIÓN

Para trabajar con MACHINE BACKEND localmente se necesita:

- Node.js
- npm
- PostgreSQL / Supabase
- Variables de entorno correctamente configuradas.

Después de clonar el proyecto:

    powershell
npm install


Esto instala las dependencias definidas en `package.json`.

---

# EJECUCIÓN EN DESARROLLO

Para iniciar el backend en modo desarrollo:

    powershell
npm run dev


El proyecto utiliza Nodemon para facilitar el desarrollo y reiniciar automáticamente el servidor cuando se detectan cambios.

El servidor local utiliza actualmente:


http://localhost:8080


---

# ESTADO DEL SERVIDOR

Cuando el backend se encuentra correctamente iniciado, MACHINE informa servicios como:


MACHINE BACKEND
SERVER: http://localhost:8080
STATUS: ONLINE
SOCKET.IO: ENABLED
DATABASE: READY
UPLOADS: ENABLED


Esto permite comprobar rápidamente el estado de los principales servicios del servidor.

---

# CORREO DE SOPORTE

MACHINE dispone de un sistema de soporte conectado al backend.

Las solicitudes realizadas desde MACHINE WEB pueden ser recibidas por el servidor y registradas en la base de datos.

El backend también puede enviar una notificación mediante correo electrónico utilizando Nodemailer.

El sistema contempla:

- Nombre del solicitante.
- Correo electrónico.
- Asunto.
- Mensaje.
- Identificador de solicitud.
- Estado.
- Fecha de creación.

Las respuestas de soporte pueden utilizar la dirección proporcionada por el usuario mediante `replyTo`, permitiendo responder directamente al remitente de la solicitud.

Las credenciales del servicio de correo nunca deben almacenarse directamente en el código fuente.

---

# SOPORTE

Las solicitudes de soporte son gestionadas mediante un endpoint público de MACHINE.

El flujo general es:


Usuario
   │
   ▼
MACHINE WEB
   │
   ▼
MACHINE BACKEND
   │
   ├── Validación
   │
   ├── PostgreSQL
   │
   └── Email
          │
          ▼
   MACHINE SUPPORT


Esto permite mantener un registro de las solicitudes y facilitar la comunicación entre MACHINE y sus usuarios.

---

# SEGURIDAD

La seguridad forma parte fundamental de la arquitectura del backend.

Se deben mantener las siguientes prácticas:

- Nunca publicar `.env`.
- Nunca publicar contraseñas.
- Nunca publicar claves privadas.
- Nunca publicar tokens.
- No almacenar credenciales directamente en el código.
- Utilizar variables de entorno.
- Validar información recibida desde el cliente.
- Proteger endpoints privados.
- Mantener dependencias actualizadas.
- Separar configuración de desarrollo y producción.
- Utilizar HTTPS en producción.
- Mantener las credenciales de servicios externos como secretos.

---

# DESARROLLO LOCAL

El entorno de desarrollo de MACHINE se divide en dos proyectos independientes:


C:\Users\Nelson\Proyectos\
│
├── machine-web
│      └── FRONTEND
│
└── machine-backend
       └── BACKEND


### FRONTEND


machine-web


Tecnología principal:


React + Vite


### BACKEND


machine-backend


Tecnología principal:


Node.js + Express


Ambos proyectos se comunican mediante HTTP y Socket.IO.

---

# COMUNICACIÓN ENTRE FRONTEND Y BACKEND

En desarrollo local:

```text
MACHINE WEB
http://localhost:5173
        │
        │ HTTP
        ▼
MACHINE BACKEND
http://localhost:8080
        │
        ├── REST API
        │
        └── Socket.IO
```

En producción, MACHINE WEB debe utilizar la URL pública correspondiente al backend desplegado.

---

# PRODUCCIÓN

El backend está diseñado para ejecutarse en un entorno de servidor.

En producción se deben configurar como secretos las variables necesarias para:

- Base de datos.
- Correo.
- Autenticación.
- Servicios externos.
- Configuración del servidor.

El frontend debe apuntar a la URL pública del backend desplegado.

La infraestructura de producción debe proporcionar:

- HTTPS.
- Variables de entorno.
- Acceso a PostgreSQL.
- Persistencia adecuada para archivos cuando corresponda.
- Soporte para conexiones Socket.IO.
- Disponibilidad continua del servidor.

---

# GIT Y CONTROL DE VERSIONES

El código fuente de MACHINE BACKEND se mantiene mediante Git.

El repositorio permite:

- Controlar versiones.
- Mantener historial de cambios.
- Recuperar versiones anteriores.
- Trabajar de forma organizada.
- Preparar el proyecto para despliegue.
- Mantener separado el código de las credenciales.

Los archivos sensibles deben permanecer fuera del repositorio.

---

# PRINCIPIOS DEL PROYECTO

MACHINE BACKEND sigue una serie de principios:

### Seguridad

La información sensible debe mantenerse protegida.

### Separación

Frontend y backend permanecen como proyectos independientes.

### Persistencia

La información importante debe mantenerse en una base de datos centralizada.

### Tiempo real

Las funciones que requieren comunicación inmediata utilizan Socket.IO.

### Escalabilidad

La arquitectura está preparada para evolucionar junto con MACHINE.

### Mantenibilidad

El código debe mantenerse organizado y documentado para facilitar futuras modificaciones.

---

# ROADMAP

El backend continuará evolucionando junto con la plataforma MACHINE.

Entre las áreas de evolución se encuentran:

- Mejora de la persistencia de conversaciones.
- Sistema multimedia completo.
- Gestión avanzada de archivos.
- Mejoras de seguridad.
- Optimización de consultas.
- Mejoras de rendimiento.
- Observabilidad y logs.
- Despliegue en producción.
- Escalabilidad.
- Nuevos servicios para la plataforma industrial.

---

# MACHINE BACKEND

MACHINE
Industrial Technology Platform


El backend constituye una de las capas fundamentales de la plataforma MACHINE, proporcionando los servicios necesarios para conectar usuarios, comunicación, información y sistemas digitales.

---

# AUTOR

**Nelson Lapizaga**

Creator & Developer of MACHINE

MACHINE es un proyecto tecnológico desarrollado para integrar servicios digitales, comunicación y funcionalidades orientadas a entornos industriales y sistemas de envasado y empaquetado.

---

# MACHINE SUPPORT

Para soporte de la plataforma:

**MACHINE Support**


machineofficialsupport@gmail.com


Este correo está destinado a la atención y gestión de solicitudes relacionadas con MACHINE.

---

# LICENCIA Y USO

MACHINE es un proyecto desarrollado por Nelson Lapizaga.

El código fuente, arquitectura, identidad visual y componentes del proyecto forman parte del desarrollo de MACHINE.

El uso, modificación o redistribución del proyecto debe realizarse de acuerdo con los permisos establecidos por el propietario del proyecto.

---

## MACHINE

**Technology for industrial environments.**


MACHINE BACKEND
Node.js • Express • PostgreSQL • Socket.IO


© MACHINE — Nelson Lapizaga
