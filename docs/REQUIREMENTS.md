# Requirements (SysML)

A SysML requirements view of Orrery Systems Modeler, with `«satisfy»` links from
the blocks that fulfil them. This mirrors what the bundled
[`exports/orrery-systems-modeler.xmi`](../exports/orrery-systems-modeler.xmi)
contains, so you can import it and explore the same requirements inside the tool.

![SysML requirements](https://www.plantuml.com/plantuml/proxy?cache=no&fmt=svg&src=https://raw.githubusercontent.com/erautiola/Orrery-Systems-Modeler/main/docs/diagrams/sysml-requirements.puml)

<details><summary>PlantUML source</summary>

```plantuml
@startuml sysml-requirements
title SysML Requirements Diagram (excerpt) with «satisfy»
skinparam shadowing false
hide circle

skinparam class<<requirement>> {
  BackgroundColor #FDECEC
  BorderColor #C0392B
}
skinparam class<<block>> {
  BackgroundColor #FFF4E8
  BorderColor #C8772E
}

class "Multi-user library" as R1 <<requirement>> {
  id = "R-1"
  text = "Projects are stored on a server and shared by the team"
}
class "Authoring" as R2 <<requirement>> {
  id = "R-2"
  text = "Create and edit UML and SysML diagrams"
}
class "Interoperability" as R3 <<requirement>> {
  id = "R-3"
  text = "Import and export OMG XMI"
}
class "Tabular views" as R4 <<requirement>> {
  id = "R-4"
  text = "Element/requirement tables and dependency matrices"
}

class Backend <<block>>
class Frontend <<block>>
class XmiIO <<block>>
class Tables <<block>>

Backend ..> R1 : <<satisfy>>
Frontend ..> R2 : <<satisfy>>
XmiIO ..> R3 : <<satisfy>>
Tables ..> R4 : <<satisfy>>
@enduml
```
</details>

## Requirement register

| ID  | Requirement | Satisfied by | Status |
|-----|-------------|--------------|--------|
| R-1 | Projects stored on a server and shared by the team | Backend / ProjectStore | ✅ done |
| R-2 | Create and edit UML & SysML diagrams | Frontend (editor + renderers) | ✅ done |
| R-3 | Import and export OMG XMI | XmiIO | ✅ done |
| R-4 | Element/requirement tables and dependency matrices | Tables | ✅ done |
| R-5 | Database/ER tables + SQL generation | Frontend (ER renderer + SQL export) | ✅ done |
| R-6 | Activity & Parametric diagrams | Frontend (renderers + editor) | ✅ done |
| R-7 | Timing & Communication diagrams | — | ⏳ planned |
