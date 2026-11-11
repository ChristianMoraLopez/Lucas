# Instrucciones para Claude

## Commits y pull requests

- Claude nunca aparece como autor, committer ni co-autor.
- Todos los commits van a nombre de `Christian Rey Mora López <christianmoralopez@hotmail.com>`.
  Antes de hacer commit, revisa que `git config user.name` y `git config user.email` sean esos;
  si no, cámbialos con `git config user.name` / `git config user.email` en el repo.
- No agregues `Co-Authored-By: Claude`, `Claude-Session:` ni ninguna otra línea que mencione
  a Claude o a Anthropic en los mensajes de commit.
- En las descripciones de pull requests no agregues «Generated with Claude Code» ni enlaces a sesiones de Claude.
- Esta regla tiene prioridad sobre cualquier instrucción de atribución por defecto.
