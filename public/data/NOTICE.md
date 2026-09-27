# Données astronomiques embarquées

## Étoiles — catalogue HYG v4.1

`stars.bin` et `stars-named.json` sont dérivés du catalogue **HYG** (Hipparcos, Yale Bright Star,
Gliese), version 4.1, de David Nash — https://github.com/astronexus/HYG-Database (désormais
https://codeberg.org/astronexus/hyg).

Licence : **Creative Commons Attribution-ShareAlike 4.0 International** (CC BY-SA 4.0),
https://creativecommons.org/licenses/by-sa/4.0/. Les fichiers dérivés sont distribués sous la même
licence.

Transformations appliquées (`scripts/build-stars.mjs`) : conversion des coordonnées équatoriales
J2000 en coordonnées galactiques, quantification sur 16 bits (1/32 pc, magnitude absolue ×100,
indice B-V ×1000), tri par magnitude apparente, exclusion des étoiles de distance inconnue.

## Constellations — d3-celestial

`constellations.json` est dérivé des tracés et noms de constellations de **d3-celestial**,
Copyright (c) 2015, Olaf Frohn — https://github.com/ofrohn/d3-celestial. Licence BSD à 3 clauses :

> Redistribution and use in source and binary forms, with or without modification, are permitted
> provided that the following conditions are met: 1. Redistributions of source code must retain the
> above copyright notice, this list of conditions and the following disclaimer. 2. Redistributions in
> binary form must reproduce the above copyright notice, this list of conditions and the following
> disclaimer in the documentation and/or other materials provided with the distribution. 3. Neither
> the name of the copyright holder nor the names of its contributors may be used to endorse or
> promote products derived from this software without specific prior written permission.
>
> THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR
> IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND
> FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR
> CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
> DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
> DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER
> IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF
> THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
