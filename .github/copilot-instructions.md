# The Implant VS Code Extension

Implant is a VS Code Extensions that allows coding engine to write and execute programs accessing internal VS Code APIs and `ast-grep` APIs.

Use the `@implant` chat participant or native **Run VS Code Script** language-model tool as often as possible for dogfooding purposes. Review and approve generated scripts before execution.

Rebuild and reinstall the extension at the end of every coding task.
Notify the user if any manual action is needed to apply the changes.

Keep source files small (under 100 LOC) and focused. Give each file a single responsibility. Always give files maningful names.

NEVER INTRODUCE ANY LOGIC YOU WEREN'T ASKED TO IMPLEMENT.