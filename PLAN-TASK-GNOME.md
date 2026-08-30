# Plan de Proyecto — Monchi GNOME TODO + Secure Vault

**Nombre provisional:** `Monchi`  
**Plataforma inicial:** Debian 13 + GNOME 48  
**Objetivo:** Crear una extensión nativa de GNOME que permita gestionar tareas desde la barra superior y almacenar posteriormente datos sensibles en un vault cifrado, portable y sincronizable.

---

## 1. Visión del producto

La aplicación tendrá tres conceptos principales:

```text
                    MONCHI
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
        TODO          VAULT         SYNC
          │            │            │
       tareas       secretos     dispositivos
       notas        passwords       cloud
```

Desde GNOME:

```text
┌─────────────────────────────────────────────┐
│ Activities              ✓ 3       11:30     │
└─────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │ MONCHI              │
                    ├─────────────────────┤
                    │ ✓ 3 tareas          │
                    │                     │
                    │ ☐ Terminar API      │
                    │ ☐ Comprar SSD       │
                    │ ☑ Deploy VPS        │
                    │                     │
                    │ + Nueva tarea       │
                    ├─────────────────────┤
                    │ 🔐 Vault            │
                    │ ☁ Synchronization   │
                    │ ⚙ Preferences       │
                    └─────────────────────┘
```

---

## 2. Objetivos

### Objetivo principal

Crear una herramienta **local-first**, integrada con GNOME, que permita:

- administrar tareas rápidamente;
- funcionar sin conexión;
- almacenar un vault cifrado;
- transportar el vault entre dispositivos;
- sincronizarlo posteriormente;
- mantener los datos sensibles cifrados de extremo a extremo.

### Principios

```text
Local-first
Security-first
Portable
Offline-first
Native GNOME
Open-source friendly
Extensible
```

---

## 3. Alcance del MVP

### MVP 0.1 — TODO

Debe permitir:

- [ ] instalar extensión;
- [ ] mostrar icono en GNOME Shell;
- [ ] abrir menú;
- [ ] crear tarea;
- [ ] editar tarea;
- [ ] completar tarea;
- [ ] eliminar tarea;
- [ ] prioridad;
- [ ] fecha límite;
- [ ] persistencia local;
- [ ] configuración básica.

Ejemplo:

```text
✓ Monchi

3 tareas pendientes

☐ Terminar facturador SUNAT
☐ Configurar servidor
☐ Comprar disco

──────────────

+ Nueva tarea
```

---

## 4. MVP 0.2 — Organización

Agregar:

```text
Projects
Lists
Tags
Priorities
Due dates
Recurring tasks
```

Modelo:

```text
Workspace
│
├── Inbox
├── Today
├── Upcoming
│
├── Projects
│   ├── SUNAT
│   ├── SANTRYX
│   └── Personal
│
└── Tags
    ├── #work
    ├── #dev
    └── #personal
```

---

## 5. MVP 0.3 — Vault

Crear:

```text
monchi.vault
```

Contenido conceptual:

```text
Vault
├── Metadata
├── Tasks
├── Notes
└── Secrets
    ├── Passwords
    ├── API Keys
    ├── SSH
    └── Secure Notes
```

Funciones:

- [ ] crear vault;
- [ ] establecer contraseña maestra;
- [ ] desbloquear;
- [ ] bloquear;
- [ ] cambiar contraseña;
- [ ] crear entradas;
- [ ] editar entradas;
- [ ] eliminar entradas;
- [ ] búsqueda;
- [ ] copiar contraseña;
- [ ] auto-lock.

---

## 6. Seguridad del Vault

Esta parte debe diseñarse **antes de implementar criptografía**.

No se debe inventar un algoritmo criptográfico propio.

Diseño conceptual:

```text
                 Master Password
                       │
                       ▼
                  KDF / KDF
                       │
                       ▼
                Encryption Key
                       │
                       ▼
                 ┌───────────┐
                 │ Vault     │
                 │ encrypted │
                 └───────────┘
```

El archivo debe contener únicamente información cifrada, junto con los metadatos criptográficos necesarios.

Nunca almacenar:

```text
password = "123456"
```

ni:

```text
master_password
```

en configuración.

---

## 7. Formato del Vault

Hay que definir una especificación propia desde el comienzo.

Por ejemplo:

```text
MONCHI VAULT
version: 1
format: encrypted
cipher: ...
kdf: ...
```

Contenido conceptual:

```json
{
    "version": 1,
    "created_at": "...",
    "updated_at": "...",
    "tasks": [],
    "notes": [],
    "secrets": []
}
```

Ese contenido debe existir dentro del payload cifrado.

El formato debe diseñarse para que posteriormente pueda ser reutilizado por:

```text
Monchi GNOME
      │
      ├── Linux
      ├── Windows
      ├── macOS
      ├── Android
      └── Web
```

---

## 8. Persistencia

Separar claramente:

```text
GNOME Extension
      │
      ▼
Application Layer
      │
      ├── TaskRepository
      ├── VaultRepository
      └── SettingsRepository
```

La UI no debe acceder directamente al sistema de archivos.

No hacer:

```text
button.click()
    ↓
writeFile()
```

La arquitectura debe permitir cambiar posteriormente SQLite, archivo cifrado o servidor sin reescribir la UI.

---

## 9. Arquitectura inicial

```text
src/
│
├── extension.ts
│
├── application/
│   ├── task-service.ts
│   ├── vault-service.ts
│   └── sync-service.ts
│
├── domain/
│   ├── task.ts
│   ├── project.ts
│   ├── tag.ts
│   ├── note.ts
│   ├── vault.ts
│   └── secret.ts
│
├── infrastructure/
│   ├── storage/
│   │   ├── task-repository.ts
│   │   └── vault-repository.ts
│   │
│   ├── crypto/
│   │   └── crypto-service.ts
│   │
│   └── sync/
│       └── sync-provider.ts
│
├── ui/
│   ├── panel.ts
│   ├── task-list.ts
│   ├── task-item.ts
│   ├── vault-dialog.ts
│   └── preferences.ts
│
└── utils/
```

Separación:

```text
UI
 ↓
Application
 ↓
Domain
 ↓
Infrastructure
```

---

# 10. Fase 1 — Fundaciones

### Objetivo

Tener una extensión mínima ejecutándose correctamente en GNOME 48.

### Tareas

- [ ] crear repositorio Git;
- [ ] crear estructura del proyecto;
- [ ] configurar TypeScript;
- [ ] configurar GJS;
- [ ] configurar ESLint;
- [ ] configurar formatter;
- [ ] crear `metadata.json`;
- [ ] crear `extension.ts`;
- [ ] crear icono;
- [ ] registrar extensión;
- [ ] instalar localmente;
- [ ] activar/desactivar;
- [ ] verificar compatibilidad con GNOME 48;
- [ ] documentar entorno de desarrollo.

### Resultado

```text
[GNOME]
    │
    ▼
[✓ MONCHI]
```

---

# 11. Fase 2 — Panel TODO

### Tareas

- [ ] indicador de panel;
- [ ] popup menu;
- [ ] contador de tareas pendientes;
- [ ] lista de tareas;
- [ ] componente `TaskItem`;
- [ ] formulario de nueva tarea;
- [ ] completar tarea;
- [ ] eliminar tarea;
- [ ] editar tarea;
- [ ] empty state.

### Resultado

MVP funcional de TODO.

---

# 12. Fase 3 — Domain Model

Definir formalmente:

```text
Task
Project
Tag
Note
Vault
Secret
```

Modelo `Task`:

```text
Task
├── id
├── title
├── description
├── status
├── priority
├── project_id
├── due_date
├── created_at
└── updated_at
```

Estados:

```text
TODO
IN_PROGRESS
COMPLETED
ARCHIVED
```

---

# 13. Fase 4 — Persistencia

Primero:

```text
Local Storage
```

Luego:

```text
Encrypted Storage
```

Hay que garantizar:

- [ ] cerrar GNOME;
- [ ] reiniciar;
- [ ] apagar equipo;
- [ ] volver a abrir;
- [ ] datos intactos.

Además:

- [ ] atomic writes;
- [ ] backup;
- [ ] corruption recovery;
- [ ] versioning.

---

# 14. Fase 5 — Vault

### Crear Vault

```text
Crear Vault
     │
     ▼
Master Password
     │
     ▼
Derivar clave
     │
     ▼
Crear vault
     │
     ▼
Encrypt
     │
     ▼
monchi.vault
```

### Desbloquear

```text
monchi.vault
     │
     ▼
Master Password
     │
     ▼
Decrypt
     │
     ▼
Memory
```

### Bloquear

```text
Memory
   │
   ▼
Clear sensitive data
   │
   ▼
LOCKED
```

---

# 15. Fase 6 — Integración GNOME

La extensión debe sentirse realmente nativa.

Funciones:

- [ ] keyboard shortcut;
- [ ] quick add;
- [ ] notificaciones;
- [ ] abrir tarea;
- [ ] bloquear vault;
- [ ] auto-lock;
- [ ] integración con clipboard;
- [ ] preferencias GNOME;
- [ ] indicador de estado.

Ejemplo:

```text
Super + Shift + T
```

abre:

```text
┌─────────────────────────┐
│ Nueva tarea             │
│                         │
│ [____________________]  │
│                         │
│             [Agregar]   │
└─────────────────────────┘
```

---

# 16. Fase 7 — Portable Vault

Objetivo principal:

```text
monchi.vault
```

Debe poder transportarse entre dispositivos:

```text
Laptop A
    │
    │ copiar
    ▼
USB
    │
    ▼
Laptop B
```

Y funcionar sin depender de una cuenta online.

También:

```text
Laptop A
   │
   ▼
monchi.vault
   │
   ▼
Laptop B
```

sin necesidad de que la aplicación sepa inicialmente dónde se está sincronizando el archivo.

---

# 17. Fase 8 — Sync Engine

La sincronización requiere un sistema de versiones.

Ejemplo:

```text
Device A
    │
    ├── version 10
    │
    ▼
Sync
    │
    ▼
Device B
    │
    └── version 9
```

Debe detectar:

```text
A > B
```

y sincronizar.

También debe contemplar cambios simultáneos:

```text
A → task X modified
B → task Y modified
```

Para esto cada objeto puede tener:

```text
id
created_at
updated_at
revision
device_id
```

El sistema debe soportar merge y detección de conflictos.

---

# 18. Fase 9 — Backend propio

Una vez que todo funcione localmente:

```text
Monchi GNOME
       │
       │ HTTPS
       ▼
┌─────────────────┐
│ FastAPI         │
│ Sync API        │
└────────┬────────┘
         │
         ▼
    PostgreSQL
```

Backend:

```text
/api/v1/
    auth/
    devices/
    vault/
    sync/
```

El backend no debería conocer las contraseñas ni el contenido desencriptado.

---

# 19. Fase 10 — Multi-dispositivo

Arquitectura futura:

```text
                 Monchi Vault
                      │
          ┌───────────┼───────────┐
          ▼           ▼           ▼
        Linux       Windows      Web
          │           │           │
          └───────────┼───────────┘
                      │
                 Sync Server
```

Clientes futuros:

```text
Android
iOS
CLI
Web
Windows
macOS
```

---

# 20. Roadmap

| Versión | Objetivo                    |
| ------- | --------------------------- |
| `0.1`   | GNOME + TODO básico         |
| `0.2`   | Projects, tags, prioridades |
| `0.3`   | Persistencia robusta        |
| `0.4`   | Vault cifrado               |
| `0.5`   | Portable `.vault`           |
| `0.6`   | Import/export               |
| `0.7`   | Sync local                  |
| `0.8`   | Sync server                 |
| `0.9`   | Multi-device                |
| `1.0`   | Release estable             |

---

# 21. Qué NO implementar inicialmente

No empezar con:

```text
❌ Kubernetes
❌ PostgreSQL
❌ FastAPI
❌ cuentas de usuario
❌ OAuth
❌ cloud
❌ aplicación móvil
❌ aplicación web
❌ microservicios
❌ sincronización compleja
```

Primero:

```text
GNOME
  ↓
TODO
  ↓
Local Storage
  ↓
Vault
  ↓
Portable file
```

Después:

```text
Portable file
       ↓
Sync
       ↓
Cloud
```

---

# 22. Definición de terminado para el MVP

El MVP estará terminado cuando se pueda hacer:

```text
Debian 13 / GNOME 48
        │
        ▼
      Monchi
        │
        ├── Crear tarea
        ├── Completar tarea
        ├── Organizar tareas
        │
        └── Vault
             │
             ├── Crear
             ├── Unlock
             ├── Lock
             ├── Crear secreto
             └── Guardar
                  │
                  ▼
             monchi.vault
```

Posteriormente:

```text
monchi.vault
     │
     ├───────────────┐
     ▼               ▼
 Laptop A          Laptop B
     │               │
     └───────┬───────┘
             ▼
          mismo Vault
```

---

# 23. Estructura del repositorio

```text
monchi/
│
├── extension/
│   ├── src/
│   ├── schemas/
│   ├── icons/
│   └── metadata.json
│
├── packages/
│   ├── domain/
│   ├── crypto/
│   └── vault-format/
│
├── docs/
│   ├── architecture/
│   ├── vault-format/
│   ├── security/
│   └── development/
│
├── tests/
│
├── scripts/
│
├── package.json
├── tsconfig.json
├── eslint.config.js
├── README.md
├── LICENSE
└── AGENTS.md
```

La separación de `vault-format` y `crypto` respecto de la extensión es deliberada: el formato del Vault no debe quedar acoplado a GNOME.

Esto permitirá reutilizarlo posteriormente en:

```text
Linux
Windows
macOS
Android
Web
CLI
```

---

# 24. Orden de implementación

El orden recomendado es:

```text
1. Arquitectura
2. Domain models
3. GNOME Extension mínima
4. TODO UI
5. Persistencia
6. Tests
7. Vault specification
8. Crypto
9. Vault UI
10. Portable .vault
11. Import/export
12. Sync protocol
13. Sync server
14. Multi-device
15. Release 1.0
```

---

# 25. Criterios técnicos generales

## Código

- TypeScript como lenguaje principal.
- GJS para integración con GNOME Shell.
- Arquitectura modular.
- Bajo acoplamiento.
- Tests para lógica de dominio.
- Linting y formatting automatizados.

## Seguridad

- No implementar criptografía propia.
- No almacenar master password.
- Minimizar permanencia de secretos en memoria.
- Auto-lock configurable.
- Limpiar datos sensibles de memoria cuando sea razonablemente posible.
- No enviar datos desencriptados al servidor.
- Diseñar el formato criptográfico antes de implementar el Vault.

## Portabilidad

El archivo `.vault` debe ser independiente de:

- distribución Linux;
- escritorio;
- ubicación del archivo;
- cliente utilizado.

## Offline-first

La aplicación debe seguir siendo funcional sin:

- Internet;
- servidor;
- cuenta;
- servicio externo.

La nube debe ser una capacidad adicional, no un requisito.

---

# 26. Primera milestone

## `M0 — Foundation`

### Objetivo

Conseguir una extensión GNOME 48 instalable y funcional que muestre el indicador `Monchi` en la barra superior.

### Definition of Done

- [ ] repositorio creado;
- [ ] estructura inicial creada;
- [ ] TypeScript configurado;
- [ ] GJS configurado;
- [ ] metadata válida para GNOME 48;
- [ ] extensión instalable;
- [ ] extensión activable;
- [ ] indicador visible en la barra;
- [ ] popup funcionando;
- [ ] código linted;
- [ ] documentación inicial;
- [ ] instrucciones de desarrollo;
- [ ] primera versión etiquetada como `0.1.0-dev`.

### Resultado esperado

```text
Debian 13
   │
   ▼
GNOME 48
   │
   ▼
Monchi Extension
   │
   ▼
[✓]
```

---

# 27. Siguiente paso

Antes de implementar funcionalidades, crear:

```text
PLAN.md
```

y después trabajar milestone por milestone.

El primer entregable de código debe ser únicamente:

```text
M0 — Foundation
```

No implementar Vault, Sync ni backend hasta que la extensión base esté estable.
