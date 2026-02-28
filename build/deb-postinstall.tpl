#!/bin/bash

if type update-alternatives 2>/dev/null >&1; then
    # Remove previous link if it doesn't use update-alternatives
    if [ -L '/usr/bin/slterm' -a -e '/usr/bin/slterm' -a "`readlink '/usr/bin/slterm'`" != '/etc/alternatives/slterm' ]; then
        rm -f '/usr/bin/slterm'
    fi
    update-alternatives --install '/usr/bin/slterm' 'slterm' '/opt/SLTerm/slterm' 100 || ln -sf '/opt/SLTerm/slterm' '/usr/bin/slterm'
else
    ln -sf '/opt/SLTerm/slterm' '/usr/bin/slterm'
fi

chmod 4755 '/opt/SLTerm/chrome-sandbox' || true

if hash update-mime-database 2>/dev/null; then
    update-mime-database /usr/share/mime || true
fi

if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
fi
