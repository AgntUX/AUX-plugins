# UX Principles

## Relay Pattern UX Principles (Summary)

**Core Principles:**
- **Purpose-Built Business Tools** - UI is the primary experience, not a conversational afterthought
- **Function Over Form** - Enterprise UIs may be "clunky" to fit business processes and that's OK
- **Complex UIs Welcome** - Tables, forms, multi-step flows, dashboards are encouraged
- **Workflow Scope** - Ideal workflows have 3-5 steps; break larger ones into multiple workflows

**What to Embrace:**
- Data tables, multi-step forms, dashboards, wizards
- Deep navigation and nested views when the workflow requires it
- Complex interactions that match the business process

**Accessibility:**
- WCAG AA compliance mandatory
- Keyboard navigation for all features
- Responsive design across viewports

## Relay Pattern UX Principles

### Core Philosophy

MCP App UIs are **purpose-built business tools**, not conversational widgets. The UI is the primary experience -- users interact with rich, functional interfaces to complete real business tasks. The AI host orchestrates the workflow, but the MCP App provides the hands-on interface.

### Design Principles

1. **Purpose-Built Business Tools**
   - Design for the specific business workflow being automated
   - UI should feel like a dedicated tool for the job, not a chat decoration
   - Complex enterprise UIs are encouraged: data tables, multi-step forms, dashboards, wizards
   - The component is where the user does real work

2. **Function Over Form**
   - Business processes are often complex -- the UI should match that complexity
   - It's OK for components to be "clunky" if that's what the workflow demands
   - Prioritize completeness and usability over visual minimalism
   - Every UI element should serve the workflow, but don't shy away from dense interfaces

3. **Complex UIs Welcome**
   - Data tables with sorting, filtering, pagination
   - Multi-step forms and wizards
   - Dashboard layouts with multiple data views
   - Deep navigation and nested views
   - Tabs, accordions, and expandable sections
   - Rich form controls: dropdowns, multi-selects, and **native date pickers** (`<input type="date">`, `<input type="datetime-local">`, `<input type="time">`) — never free-text inputs for dates. When specifying user interactions that capture a date, time, or deadline, the spec must call this out so the designer and coder follow through.

4. **Workflow Scope Guidance**
   - Ideal workflows have **3-5 steps**: call third-party MCP -> call AgntUX MCP -> user interacts -> call third-party MCP based on user action
   - Looping is fine (e.g., review items one by one), but 10+ step workflows should be broken into multiple workflows
   - Each workflow should automate **one business process**
   - Multiple UI components per workflow are fine (for different workflow steps)

5. **Responsive Design**
   - Components must work across viewport sizes
   - Use responsive layouts that adapt to container dimensions
   - Design mobile-first but don't sacrifice desktop functionality
   - Test at multiple breakpoints

6. **Design for the 600px Inline Budget — Scroll, Don't Clip**
   - The host gives inline / inline-card iframes ~400–600px of height (`hostContext.containerDimensions.maxHeight`). Every feature MUST remain fully usable at 600px tall via internal scrolling, never by relying on the host to grow the iframe.
   - See **Display Modes › Inline Viewport Budget** for the authoritative list of banned / required patterns. Fullscreen is an opt-in enhancement (an "Expand" affordance for dense views), never a workaround for a broken inline layout.

### Accessibility (WCAG AA Mandatory)

- All interactive elements must have ARIA labels
- Keyboard navigation required for all features
- Color contrast must meet WCAG AA standards (4.5:1 for normal text, 3:1 for large text)
- Use semantic HTML (`<button>`, `<nav>`, `<main>`, `<table>`, etc.)
- Provide alt text for all images
- Support text resizing without breaking layouts
- Focus indicators must be visible
- Tab order must be logical

### What NOT to Do

- Don't artificially simplify a complex business process to fit a minimal UI
- Don't limit buttons, actions, or navigation depth based on aesthetic concerns
- Don't treat the component as a "card" -- it can be a full application
- Don't duplicate host features (input composer, conversation history)
