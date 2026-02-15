# Store the initial ZDOTDIR value
SLTERM_ZDOTDIR="$ZDOTDIR"

# Source the original zshenv
[ -f ~/.zshenv ] && source ~/.zshenv

# Detect if ZDOTDIR has changed
if [ "$ZDOTDIR" != "$SLTERM_ZDOTDIR" ]; then
  # If changed, manually source your custom zshrc from the original SLTERM_ZDOTDIR
  [ -f "$SLTERM_ZDOTDIR/.zshrc" ] && source "$SLTERM_ZDOTDIR/.zshrc"
fi