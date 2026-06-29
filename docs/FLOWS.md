# Behavior & Flows

UML behavioral views of the key interactions. Sources in [`docs/diagrams/`](diagrams).

## Activity (example)

An Activity diagram models control flow through actions, decisions, and forks
(optionally grouped into swimlane partitions).

![Activity](https://www.plantuml.com/plantuml/proxy?cache=no&fmt=svg&src=https://raw.githubusercontent.com/erautiola/Orrery-Systems-Modeler/main/docs/diagrams/activity.puml)

<details><summary>PlantUML source</summary>

```plantuml
@startuml activity
title Order fulfilment — Activity
skinparam shadowing false
start
:Pick items;
if (in stock?) then (yes)
  :Pack order;
  :Ship;
else (no)
  :Backorder;
endif
stop
@enduml
```
</details>

## Use cases

![Use cases](https://www.plantuml.com/plantuml/proxy?cache=no&fmt=svg&src=https://raw.githubusercontent.com/erautiola/Orrery-Systems-Modeler/main/docs/diagrams/usecase.puml)

<details><summary>PlantUML source</summary>

```plantuml
@startuml usecase
title Orrery Systems Modeler — Use Cases
left to right direction
skinparam shadowing false

actor "Systems Engineer" as SE
actor "Teammate" as TM

rectangle "Orrery Systems Modeler" {
  usecase "Open / create project" as U1
  usecase "Author diagrams" as U2
  usecase "Edit element properties" as U3
  usecase "Build tables & matrices" as U4
  usecase "Import / export XMI" as U5
  usecase "Save to shared library" as U6
  usecase "Export SVG / CSV" as U7
}

SE --> U1
SE --> U2
SE --> U4
SE --> U5
SE --> U6
SE --> U7
TM --> U1
TM --> U6
U2 ..> U3 : <<include>>
@enduml
```
</details>

## Save project (optimistic concurrency)

Saves carry the `rev` the client started from. If another teammate saved in the
meantime, the server returns **409** instead of silently overwriting.

![Save sequence](https://www.plantuml.com/plantuml/proxy?cache=no&fmt=svg&src=https://raw.githubusercontent.com/erautiola/Orrery-Systems-Modeler/main/docs/diagrams/save-sequence.puml)

<details><summary>PlantUML source</summary>

```plantuml
@startuml save-sequence
title Save Project — optimistic concurrency (UML Sequence)
skinparam shadowing false
actor User
participant "app.js" as App
participant "api.js" as Api
participant "server.js\n(Express)" as Srv
participant "store.js" as Store
database "project JSON" as Lib

User -> App : Ctrl+S / Save
activate App
App -> Api : save(id, {name, model, rev})
activate Api
Api -> Srv : PUT /api/projects/:id
activate Srv
Srv -> Store : save(id, {rev})
activate Store
Store -> Lib : read current
alt client rev == server rev
  Store -> Lib : rev++ ; write (temp + rename)
  Store --> Srv : project (rev+1)
  Srv --> Api : 200 OK
  Api --> App : project
  App -> User : "Saved (rev N)"
else stale rev
  Store --> Srv : Conflict
  Srv --> Api : 409 Conflict
  Api --> App : error(409)
  App -> User : offer reload
end
deactivate Store
deactivate Srv
deactivate Api
deactivate App
@enduml
```
</details>

## Import XMI

![Import sequence](https://www.plantuml.com/plantuml/proxy?cache=no&fmt=svg&src=https://raw.githubusercontent.com/erautiola/Orrery-Systems-Modeler/main/docs/diagrams/import-sequence.puml)

<details><summary>PlantUML source</summary>

```plantuml
@startuml import-sequence
title Import XMI -> new shared project (UML Sequence)
skinparam shadowing false
actor User
participant "app.js" as App
participant "xmi-parser.js" as P
participant "xmi-import.js" as I
participant "layout.js" as L
participant "api.js" as Api
participant "server.js" as Srv

User -> App : Import XMI (button / drag-drop)
activate App
App -> P : parse(xmlText)
activate P
P --> App : parser model (id -> element map)
deactivate P
App -> I : fromXmi(text)
activate I
I -> L : layout(nodes, edges) per package
L --> I : node positions
I --> App : internal model + diagrams
deactivate I
App -> Api : create(name, model)
Api -> Srv : POST /api/projects
Srv --> Api : project
Api --> App : project
App -> App : open & render first diagram
App -> User : diagram shown, editable
deactivate App
@enduml
```
</details>

## Editor tool — State Machine

![Editor state machine](https://www.plantuml.com/plantuml/proxy?cache=no&fmt=svg&src=https://raw.githubusercontent.com/erautiola/Orrery-Systems-Modeler/main/docs/diagrams/state-machine.puml)

<details><summary>PlantUML source</summary>

```plantuml
@startuml state-machine
title Editor Tool — State Machine
skinparam shadowing false

[*] --> Select
Select --> PlacingElement : pick element tool
Select --> Linking : pick relationship tool
PlacingElement --> Select : click canvas [element created]
Linking --> Select : release on target [relationship created]
Linking --> Select : release on empty [cancelled]

state Select {
  [*] --> Idle
  Idle --> Dragging : mousedown on node
  Dragging --> Idle : mouseup [position saved]
  Idle --> Resizing : mousedown on handle
  Resizing --> Idle : mouseup [size saved]
}
@enduml
```
</details>
