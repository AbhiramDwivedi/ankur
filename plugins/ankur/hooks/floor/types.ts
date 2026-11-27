// The floor's view model. It is declared in the plugin's types contract (types/index.d.ts), which must be
// self-contained, and re-exported here so the floor files import it from one place.
export type {
  AdrView, CrewView, DecisionView, DiagramView, FloorView, MemberView, NeedView, Status, StuckView, Tab,
} from '../../types/index.d.ts'
