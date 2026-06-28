# Architecture

Orrery Systems Modeler is a framework-free browser SPA talking to a small
Node/Express server over a REST API. The server stores each project as a JSON
document in a shared library (a Docker volume). Everything ships in one Docker
image.

> **Rendering note.** Diagrams below are written in [PlantUML](https://plantuml.com).
> GitHub shows the rendered image via the public PlantUML proxy; the source is
> embedded under each *PlantUML source* dropdown and also lives in
> [`docs/diagrams/`](diagrams). To render locally: `plantuml docs/diagrams/*.puml`.

## Component architecture

![Component architecture](https://www.plantuml.com/plantuml/proxy?cache=no&fmt=svg&src=https://raw.githubusercontent.com/erautiola/Orrery-Systems-Modeler/main/docs/diagrams/architecture.puml)

<details><summary>PlantUML source</summary>

```plantuml
@startuml architecture
title Orrery Systems Modeler — Component Architecture
skinparam componentStyle rectangle
skinparam shadowing false
left to right direction

actor "Modeler\n(browser)" as User

node "Browser SPA (public/)" as SPA {
  [index.html + styles] as UI
  [app.js — controller] as App
  [editor.js — interaction] as Editor
  [renderer.js / seq-renderer.js] as Renderers
  [model.js — type catalog] as Catalog
  [xmi-import.js / xmi-export.js] as Xmi
  [layout.js — auto-layout] as Layout
  [api.js — REST client] as ApiClient
}

node "Node.js Server (server/)" as Server {
  [server.js — Express REST API] as REST
  [store.js — file store] as Store
  [static file serving] as Static
}

database "Project library\n(JSON files in Docker volume)" as Lib

User --> UI
UI --> App
App --> Editor
App --> Renderers
App --> Catalog
App --> Xmi
App --> Layout
App --> ApiClient
ApiClient ..> REST : HTTP / JSON
REST --> Store
Store --> Lib
REST --> Static
Static ..> SPA : serves
@enduml
```
</details>

**Key points**

- The **browser holds the model** and does all parsing/serialization/rendering.
  The server is deliberately thin: serve static files + CRUD on JSON documents.
- **`model.js`** is the single source of truth for the UML/SysML *type catalog*
  (which elements/relationships each diagram type offers, and how they draw).
- Rendering is split: **`renderer.js`** for node-and-edge diagrams (class, BDD,
  state machine, …) and **`seq-renderer.js`** for sequence diagrams.

## Deployment

![Deployment](https://www.plantuml.com/plantuml/proxy?cache=no&fmt=svg&src=https://raw.githubusercontent.com/erautiola/Orrery-Systems-Modeler/main/docs/diagrams/deployment.puml)

<details><summary>PlantUML source</summary>

```plantuml
@startuml deployment
title Orrery Systems Modeler — Deployment
skinparam shadowing false

node "Client device" {
  artifact "Web browser" as B
}

node "Docker host (any OS / cloud)" {
  node "orrery-systems-modeler container" as C {
    artifact "Node 20 + Express\n(listens :8137)" as N
  }
  database "modeler-data volume\n(/data — JSON projects)" as V
}

B --> C : HTTP\nhost :8080 -> container :8137
N --> V : reads/writes project JSON
@enduml
```
</details>

The container listens on `8137`; `docker-compose.yml` publishes it on host
`8080`. The project library lives in the `modeler-data` named volume so data
survives restarts and image upgrades.

## SysML view — Block Definition Diagram

The same system, expressed as SysML blocks (Orrery dogfooding its own notation).

![SysML BDD](https://www.plantuml.com/plantuml/proxy?cache=no&fmt=svg&src=https://raw.githubusercontent.com/erautiola/Orrery-Systems-Modeler/main/docs/diagrams/sysml-bdd.puml)

<details><summary>PlantUML source</summary>

```plantuml
@startuml sysml-bdd
title SysML Block Definition Diagram (BDD) — System Blocks
skinparam shadowing false
skinparam class {
  BackgroundColor #FFF4E8
  BorderColor #C8772E
}
hide circle

class Application <<block>>
class Frontend <<block>> {
  values
  diagramTypes : int = 9
}
class Backend <<block>> {
  values
  port : int = 8137
}
class ProjectStore <<block>> {
  values
  format : String = "JSON"
  concurrency : String = "rev-checked"
}
class Renderer <<block>>
class SequenceRenderer <<block>>
class Editor <<block>>
class XmiIO <<block>>

Application *-- "1" Frontend
Application *-- "1" Backend
Backend *-- "1" ProjectStore
Frontend *-- "1" Renderer
Frontend *-- "1" SequenceRenderer
Frontend *-- "1" Editor
Frontend *-- "1" XmiIO
@enduml
```
</details>

> 💡 You can **import this system model into Orrery itself** — see
> [`exports/orrery-systems-modeler.xmi`](../exports/orrery-systems-modeler.xmi)
> (Import XMI → it opens as a SysML BDD with requirements).
