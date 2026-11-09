# 아이콘 생성: 주황 둥근 사각형 + 흰 문서 + 주황 T + 아래 화살표(임시저장). python extension/make-icons.py
from PIL import Image, ImageDraw
S = 1024
im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(im)
d.rounded_rectangle((0, 0, S - 1, S - 1), radius=220, fill=(235, 83, 31, 255))
# 흰 문서 안에 주황 T + 아래 화살표
O = (235, 83, 31, 255)
d.rounded_rectangle((230, 120, 794, 720), radius=60, fill="white")
d.rounded_rectangle((330, 230, 694, 330), radius=24, fill=O)
d.rounded_rectangle((462, 230, 562, 640), radius=24, fill=O)
d.polygon([(512, 920), (380, 790), (644, 790)], fill="white")
for n in (16, 48, 128):
    im.resize((n, n), Image.LANCZOS).save(f"extension/icons/{n}.png")
