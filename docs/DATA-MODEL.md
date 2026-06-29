# Data Model

A *project* is one JSON document. Its `model` is the entire UML/SysML model plus
the diagrams and tables that view it. This is also the format persisted by the
server and produced by XMI import.

```
project = { id, name, rev, createdAt, updatedAt, model }
model   = { name, elements[], relationships[], diagrams[], tables[] }
```

![Data model class diagram](https://www.plantuml.com/plantuml/proxy?cache=no&fmt=svg&src=https://raw.githubusercontent.com/erautiola/Orrery-Systems-Modeler/main/docs/diagrams/data-model.puml)

<details><summary>PlantUML source</summary>

```plantuml
@startuml data-model
title Internal Model (public/js/model.js) — UML Class Diagram
skinparam shadowing false
hide empty members

class Model {
  name : string
}
class Element {
  id : string
  type : string
  name : string
  stereotypes : string[]
  isAbstract : boolean
  tags : map
  ownerId : string
  --
  ' state machine
  entry / exit / doActivity : string
  isComposite : boolean
  regions : int
  ' sequence
  represents : string
}
class Attribute {
  name : string
  type : string
  visibility : string
  multiplicity : string
  defaultValue : string
  isStatic / isDerived : boolean
}
class Operation {
  name : string
  returnType : string
  visibility : string
  isStatic / isAbstract : boolean
}
class Parameter {
  name : string
  type : string
  direction : string
}
class Relationship {
  id : string
  type : string
  sourceId / targetId : string
  name : string
  --
  ' transition
  trigger / guard / effect : string
  ' message
  y : number
  args / returnValue : string
}
class Diagram {
  id : string
  type : string
  name : string
}
class DiagramNode {
  x / y / w / h : number
}
class Table {
  id : string
  kind : "element" | "matrix"
  name : string
  elementType / columns : *
  rowType / colType / relType : string
}

Model "1" *-- "*" Element
Model "1" *-- "*" Relationship
Model "1" *-- "*" Diagram
Model "1" *-- "*" Table
Element "1" *-- "*" Attribute
Element "1" *-- "*" Operation
Operation "1" *-- "*" Parameter
Diagram "1" *-- "*" DiagramNode
DiagramNode "*" --> "1" Element : elementId
Relationship "*" --> "1" Element : source / target
Element "0..1" o-- "*" Element : ownerId (containment)
@enduml
```
</details>

## Notes on the design

- **Elements are shared across diagrams.** A `Diagram` does not own elements; it
  holds `nodes` that *place* existing elements (by `elementId`) at an `x,y,w,h`.
  The same block can appear on several diagrams; tables and matrices read the
  same elements. Deleting an element removes it from the model and every diagram.
- **Containment** (`ownerId`) drives nested rendering — composite states and
  packages. For a nested node, its `x,y` are *relative to the parent's content
  origin*; the renderer accumulates absolute positions for edge routing.
- **Type‑specific fields** live on the generic `Element`/`Relationship`:
  state machines use `entry/exit/doActivity/isComposite/regions` and transition
  `trigger/guard/effect`; sequence diagrams use lifeline `represents` and message
  `y/args/returnValue`. The **type catalog** in `model.js`
  (`ELEMENTS`, `RELATIONSHIPS`, `DIAGRAMS`, `TABLES`) decides what is valid and
  how it draws.
- **Tables** are views, not data: an `element` table filters/renders elements
  into editable cells; a `matrix` reads/writes relationships of a chosen type.

## Database / ER tables (data modeling)

The **ER / Data Model** diagram type models relational schemas. A `dbtable`
element carries `columns` (`{ name, dataType, pk, nullable, unique, defaultValue }`)
instead of UML attributes, and a `fk` relationship (crow's-foot notation) links a
child table to its parent, carrying `fkColumn` / `refColumn`.

![ER example](https://www.plantuml.com/plantuml/proxy?cache=no&fmt=svg&src=https://raw.githubusercontent.com/erautiola/Orrery-Systems-Modeler/main/docs/diagrams/er-data-model.puml)

<details><summary>PlantUML source</summary>

```plantuml
@startuml er-data-model
hide circle
skinparam linetype ortho
entity customer {
  * id : INT <<PK>>
  --
  * email : VARCHAR(255) <<unique>>
  name : VARCHAR(120)
}
entity "order" as ord {
  * id : INT <<PK>>
  --
  * customer_id : INT <<FK>>
  total : DECIMAL(10,2)
  placed_at : TIMESTAMP
}
customer ||--o{ ord : places
@enduml
```
</details>

**Export → SQL DDL** turns that into runnable DDL (PK / NOT NULL / UNIQUE /
DEFAULT, composite keys, FK constraints, and reserved-word quoting):

```sql
CREATE TABLE customer (
  id INT NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  name VARCHAR(120),
  PRIMARY KEY (id)
);

CREATE TABLE "order" (
  id INT NOT NULL,
  customer_id INT NOT NULL,
  total DECIMAL(10,2),
  placed_at TIMESTAMP,
  PRIMARY KEY (id)
);

ALTER TABLE "order" ADD CONSTRAINT fk_order_1
  FOREIGN KEY (customer_id) REFERENCES customer (id);
```

SQL generation is covered by unit tests in `server/test/sql-export.test.js`.
