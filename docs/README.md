# Orrery Systems Modeler — Documentation

| Doc | What's inside |
|-----|----------------|
| [USER-GUIDE.md](USER-GUIDE.md) | How to run and use every feature |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Component & deployment diagrams, SysML BDD |
| [DATA-MODEL.md](DATA-MODEL.md) | The internal model as a UML class diagram |
| [FLOWS.md](FLOWS.md) | Use cases, save/import sequences, editor state machine |
| [REQUIREMENTS.md](REQUIREMENTS.md) | SysML requirements + register |
| [API.md](API.md) | REST API reference |

All diagrams are **PlantUML** (UML + SysML). Sources live in
[`diagrams/`](diagrams) and are embedded (with rendered images) in the docs
above. Render locally with:

```bash
plantuml docs/diagrams/*.puml      # needs Java + PlantUML
```

The architecture/requirements model is also provided as an importable
**XMI**: [`../exports/orrery-systems-modeler.xmi`](../exports/orrery-systems-modeler.xmi)
— open Orrery and **Import XMI** to explore it in the tool itself.
