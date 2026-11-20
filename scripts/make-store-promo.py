#!/usr/bin/env python3
"""Create an optional 440x280 promo tile using only the supplied emblem.
Also remove the alpha channel from actual 1280x800 extension screenshots.
"""
from pathlib import Path
import sys
from PIL import Image, ImageDraw
out=Path(sys.argv[1])
for image in sorted(out.glob('0[1-4]-*.png')):
    with Image.open(image) as shot:
        assert shot.size==(1280,800), f'{image} has the wrong size'
        shot.convert('RGB').save(image,optimize=True)
# A minimal geometric brand tile, not a mockup of unsupported features.
scale=2
im=Image.new('RGB',(440*scale,280*scale),'#18141e')
draw=ImageDraw.Draw(im)
draw.rectangle((0,0,440*scale,280*scale),fill='#1b1720')
draw.polygon([(0,0),(220*scale,0),(72*scale,280*scale),(0,280*scale)],fill='#b390e6')
draw.polygon([(440*scale,0),(440*scale,280*scale),(345*scale,280*scale),(412*scale,0)],fill='#e0c7fb')
draw.rounded_rectangle((142*scale,48*scale,298*scale,204*scale),radius=12*scale,fill='#faf7fa')
logo=Image.open('apps/dashboard/assets/ghoststate-logo.png').convert('RGB').resize((136*scale,136*scale),Image.Resampling.LANCZOS)
im.paste(logo,(152*scale,58*scale))
draw.rounded_rectangle((180*scale,232*scale,260*scale,237*scale),radius=3*scale,fill='#b390e6')
im.resize((440,280),Image.Resampling.LANCZOS).save(out/'optional-promo-440x280.png',optimize=True)
