#!/usr/bin/env python3
"""Recover the supplied PulseDeck mark from its shipped 512px PNG, not a new design.
The original SVG was not in the supplied archives. Subpixel contours are traced
from the white mark of mono-monitor.png; no network assets or OCR are involved.
Requires Pillow, NumPy, scikit-image and OpenCV only for regeneration.
"""
from pathlib import Path
import hashlib, json, re
import numpy as np
from PIL import Image
from skimage.measure import find_contours
import cv2
ROOT=Path(__file__).resolve().parents[1]
src=ROOT/'app/assets/app-icons/mono-monitor.png'
rgba=np.array(Image.open(src).convert('RGBA'))
# All white artwork is inside this region; dark background/gloss and the shadow
# are below 110. 160 is approximately half coverage of the antialiased white edge.
light=rgba[:,:,:3].min(axis=2).astype(float)
mask=np.zeros_like(light); mask[120:391,110:403]=light[120:391,110:403]
paths=[]
for contour in find_contours(mask,160):
    xy=np.stack((contour[:,1],contour[:,0]),axis=1).astype('float32')
    if abs(cv2.contourArea(xy))<1: continue
    # Keep subpixel detail but avoid thousands of collinear raster vertices.
    xy=cv2.approxPolyDP(xy, .18, True).reshape(-1,2)
    paths.append('M'+' L'.join(f'{x:.2f} {y:.2f}' for x,y in xy)+' Z')
path=' '.join(paths)
svg=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><!-- Recovered from the supplied mono-monitor.png, not the unavailable original SVG. --><path fill="currentColor" fill-rule="evenodd" d="{path}"/></svg>\n'
(ROOT/'app/assets/app-icons/monitor-mark.svg').write_text(svg)
(ROOT/'design-source/monitor-mark-provenance.json').write_text(json.dumps({'source':'app/assets/app-icons/mono-monitor.png','sha256':hashlib.sha256(src.read_bytes()).hexdigest(),'original_svg_found':False,'method':'Subpixel isocontours at intensity 160, polygon simplification <= 0.18 px on the 512px source','contours':len(paths)},indent=2)+'\n')
# Keep the generated mark embedded in the shared browser/Node renderer in sync.
shared=ROOT/'app/shared/app-icon.js'
if shared.exists():
    source=shared.read_text()
    source,count=re.subn(r'  const markPath="[^"]*";',lambda _:'  const markPath='+json.dumps(path)+';',source,count=1)
    if count!=1: raise RuntimeError('Shared mark declaration was not found')
    shared.write_text(source)
print(len(paths),'contours,',len(svg),'bytes')
