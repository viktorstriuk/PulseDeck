#!/usr/bin/env python3
"""Rasterize the four compatible icon IDs (three refreshed pastel colours in 2.8.2) with the SAME recovered PulseDeck music mark.
Old eight builtin PNG/ICO assets are intentionally kept byte-for-byte unchanged.
Requires Node.js, CairoSVG and Pillow; shared/app-icon.js is used by the editor too.
"""
from pathlib import Path
import subprocess,json,io
import cairosvg
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
colours={'sky':(['#fff9fc','#ff9acb'],'#15151b'),'coral':(['#ffffff','#dce4f2'],'#15151b'),'lime':(['#fffdf5','#e7c88e'],'#15151b'),'noir':(['#2a313d','#828998'],'#f7faff')}
for name,(bg,fg) in colours.items():
    draft={'bg':[{'color':c,'pos':i*100} for i,c in enumerate(bg)],'fg':[{'color':fg,'pos':0}]}
    svg=subprocess.check_output(['node','-e',"process.stdout.write(require('./app/shared/app-icon').build(JSON.parse(process.argv[1])))",json.dumps(draft)],cwd=ROOT)
    png=cairosvg.svg2png(bytestring=svg,output_width=512,output_height=512)
    target=ROOT/f'app/assets/app-icons/{name}-monitor'
    target.with_suffix('.png').write_bytes(png)
    im=Image.open(io.BytesIO(png));im.save(target.with_suffix('.ico'),sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
    print(name)
