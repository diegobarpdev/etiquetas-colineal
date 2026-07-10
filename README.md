# Etiquetas Colineal

Sistema web para generar etiquetas PDF para impresoras Zebra, a partir de órdenes de fabricación (datos mock en PostgreSQL, preparado para integración futura con Odoo).

## Requisitos

- **Docker** (recomendado para otra PC): Docker Desktop o Docker Engine + Compose
- **Desarrollo local**: Node.js 20+ y Docker (solo para PostgreSQL)

---

## Opción A — Docker (otra PC / producción)

Clona el repositorio y levanta todo con un comando:

```bash
git clone https://github.com/TU_USUARIO/etiquetas-colineal.git
cd etiquetas-colineal
docker compose up --build -d
```

Abre en el navegador:

- En la misma máquina: http://localhost:3000
- Desde otra PC en la red: http://IP_DE_LA_MAQUINA:3000

Comandos útiles:

| Comando | Descripción |
|---|---|
| `docker compose up --build -d` | Construir y levantar app + base de datos |
| `docker compose down` | Detener contenedores |
| `docker compose logs -f app` | Ver logs de la aplicación |
| `docker compose up --build -d --force-recreate` | Reconstruir tras cambios |

La primera vez aplica migraciones y carga datos mock automáticamente.

---

## Opción B — Desarrollo local

```bash
npm install
cp .env.example .env
npm run db:up          # solo PostgreSQL en Docker (puerto 5433)
npx prisma migrate deploy
npm run db:seed
npm run dev
```

Abrir http://localhost:3000

---

## Scripts npm

| Comando | Descripción |
|---|---|
| `npm run dev` | Servidor de desarrollo con hot reload |
| `npm run build` | Compilar TypeScript |
| `npm start` | Ejecutar en producción |
| `npm test` | Tests unitarios |
| `npm run db:up` | Levantar solo PostgreSQL |
| `npm run db:seed` | Cargar datos mock |
| `npm run docker:up` | `docker compose up --build -d` |
| `npm run docker:down` | Detener stack Docker |

---

## API

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/health` | Estado del servidor y URLs de red |
| GET | `/api/orders?q=` | Buscar órdenes |
| GET | `/api/orders/:id` | Detalle + resumen |
| GET | `/api/orders/:id/labels/html` | Vista previa HTML |
| POST | `/api/orders/:id/labels/generate` | Descargar PDF |
| GET | `/api/templates` | Listar plantillas |

---

## Datos mock (seed)

| Orden | Producto / notas |
|---|---|
| `PLDOR/OPR/00564` | Kit cama + velador |
| `PLDOR/OPR/00565` | Colchones Milo |
| `PSTAB/OPR/00859` | Tableros conforme (1 bulto) |
| `PLCAJ/OPR/00083` | Velador Capri conforme papel (54 uds) |
| `PLCAJ/OPR/00084` | Velador Capri Carpenter (54 uds) |

---

## Plantillas

Carpeta: `src/templates/labels/<codigo>/` (`template.hbs` + `styles.css`)

| Código | Descripción |
|---|---|
| `bulto-estandar` | Producto terminado (muebles) |
| `colchon-v1` / `colchon-v2` | Colchones |
| `producto-conforme` | Producto conforme |
| `producto-conforme-papel` | Conforme de papel |
| `carpinteria` | Producto conforme Carpenter |

---

## Estructura

```
src/
├── index.ts              # Servidor Express
├── routes/api.ts         # API REST
├── services/             # Lógica de negocio y PDF
├── templates/labels/     # Plantillas Handlebars
└── public/               # UI web
prisma/
├── schema.prisma
├── migrations/
└── seed.ts
docker/
└── entrypoint.sh         # Migraciones + seed al iniciar
```

---

## Subir a GitHub

```bash
git init
git add .
git commit -m "Initial commit: etiquetas Colineal con Docker"
gh repo create etiquetas-colineal --private --source=. --push
```

(Sustituye `--private` por `--public` si quieres repositorio público.)
