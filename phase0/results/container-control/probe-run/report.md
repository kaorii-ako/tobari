# Font probe: chromium

- date: 2026-10-30T05:55:34+00:00
- host: vm (Ubuntu 24.04.5 LTS)
- inside distrobox: no
- session: unknown 

## fontconfig as the engine sees it
```
$ fc-match 'sans-serif:lang=ja'
WenQuanYi Zen Hei | /usr/share/fonts/truetype/wqy/wqy-zenhei.ttc | index=0
$ fc-match 'sans-serif:lang=th'
Loma | /usr/share/fonts/opentype/tlwg/Loma.otf
$ fc-match 'Noto Sans CJK JP'
Inter | /usr/share/fonts/opentype/inter/Inter-Regular.otf | index=0
$ fc-list :lang=ja file | wc -l
8
$ fc-list | grep -i cjk | head
$ fc-cache --version
fontconfig version 2.15.0
$ env | grep -i fontconfig
(none)
```

## headless verdict (--dump-dom)
```
TOBARI-PROBE-BEGIN
PASS ja-stack
PASS ja-generic
PASS ja-serif
PASS ja-nolang
PASS ja-noto-only
PASS zh-hans
PASS ko
PASS th-stack
PASS th-generic
PASS mixed
PASS ui-default
TOBARI-PROBE-END
```

screenshot: headless.png

## headful strace (15 s)
## strace summary

- CJK font opened (success): 0
- CJK font ENOENT: 0
- CJK font EACCES/EPERM: 0
- lang=ja fallback file wqy-zenhei.ttc opened (success): 1
- lang=ja fallback file wqy-zenhei.ttc failed: 0
- Thai font opened (success): 7
- any font path EACCES/EPERM: 0

### libfontconfig / libfreetype / libharfbuzz loaded
```
"/lib/x86_64-linux-gnu/libfontconfig.so.1", O_RDONLY|O_CLOEXEC) = 3
"/lib/x86_64-linux-gnu/libfontconfig.so.1", O_RDONLY|O_CLOEXEC) = 4
"/lib/x86_64-linux-gnu/libfontconfig.so.1", O_RDONLY|O_CLOEXEC) = 5
"/lib/x86_64-linux-gnu/libfreetype.so.6", O_RDONLY|O_CLOEXEC) = 3
"/lib/x86_64-linux-gnu/libfreetype.so.6", O_RDONLY|O_CLOEXEC) = 4
"/lib/x86_64-linux-gnu/libfreetype.so.6", O_RDONLY|O_CLOEXEC) = 5
"/lib/x86_64-linux-gnu/libharfbuzz.so.0", O_RDONLY|O_CLOEXEC) = 3
"/lib/x86_64-linux-gnu/libharfbuzz.so.0", O_RDONLY|O_CLOEXEC) = 4
"/lib/x86_64-linux-gnu/libharfbuzz.so.0", O_RDONLY|O_CLOEXEC) = 5
```

### fontconfig config files read
```
"/etc/fonts/conf.avail/20-unhint-small-dejavu-lgc-sans-mono.conf"
"/etc/fonts/conf.avail/20-unhint-small-dejavu-lgc-sans.conf"
"/etc/fonts/conf.avail/20-unhint-small-dejavu-lgc-serif.conf"
"/etc/fonts/conf.avail/20-unhint-small-dejavu-sans-mono.conf"
"/etc/fonts/conf.avail/20-unhint-small-dejavu-sans.conf"
"/etc/fonts/conf.avail/20-unhint-small-dejavu-serif.conf"
"/etc/fonts/conf.avail/25-wqy-zenhei.conf"
"/etc/fonts/conf.avail/57-dejavu-sans-mono.conf"
"/etc/fonts/conf.avail/57-dejavu-sans.conf"
"/etc/fonts/conf.avail/57-dejavu-serif.conf"
"/etc/fonts/conf.avail/58-dejavu-lgc-sans-mono.conf"
"/etc/fonts/conf.avail/58-dejavu-lgc-sans.conf"
"/etc/fonts/conf.avail/58-dejavu-lgc-serif.conf"
"/etc/fonts/conf.avail/64-wqy-zenhei.conf"
"/etc/fonts/conf.avail/65-fonts-ipafont-gothic.conf"
"/etc/fonts/conf.d/12-unhinted-grayscale.conf"
"/etc/fonts/conf.d/56-prefer-inter.conf"
"/etc/fonts/fonts.conf"
"/usr/share/fontconfig/conf.avail/10-scale-bitmap-fonts.conf"
```

### fontconfig cache dirs touched
```
"/root/.cache/fontconfig/0bd3dc0958fa2205aaaa8ebb13e2872b-le64.cache-11", O_RDONLY|O_CLOEXEC) = -1 ENOENT
"/root/.cache/fontconfig/3047814df9a2f067bd2d96a2b9c36e5a-le64.cache-11", O_RDONLY|O_CLOEXEC) = -1 ENOENT
"/root/.cache/fontconfig/3830d5c3ddfd5cd38a049b759396e72e-le64.cache-11", O_RDONLY|O_CLOEXEC) = -1 ENOENT
"/root/.cache/fontconfig/4c599c202bc5c08e2d34565a40eac3b2-le64.cache-11", O_RDONLY|O_CLOEXEC) = -1 ENOENT
"/root/.cache/fontconfig/573ec803664ed168555e0e8b6d0f0c7f-le64.cache-11", O_RDONLY|O_CLOEXEC) = -1 ENOENT
"/root/.cache/fontconfig/6333f38776742d18e214673cd2c24e34-le64.cache-11", O_RDONLY|O_CLOEXEC) = -1 ENOENT
"/root/.cache/fontconfig/7ef2298fde41cc6eeb7af42e48b7d293-le64.cache-11", O_RDONLY|O_CLOEXEC) = -1 ENOENT
"/root/.cache/fontconfig/99e8ed0e538f840c565b6ed5dad60d56-le64.cache-11", O_RDONLY|O_CLOEXEC) = -1 ENOENT
"/root/.cache/fontconfig/9f5be04c82fedbbce398861326c6c8e3-le64.cache-11", O_RDONLY|O_CLOEXEC) = -1 ENOENT
"/root/.cache/fontconfig/c855463f699352c367813e37f3f70ea7-le64.cache-11", O_RDONLY|O_CLOEXEC) = -1 ENOENT
"/root/.cache/fontconfig/d52a8644073d54c13679302ca1180695-le64.cache-11", O_RDONLY|O_CLOEXEC) = -1 ENOENT
"/root/.cache/fontconfig/d589a48862398ed80a3d6066f4f56f4c-le64.cache-11", O_RDONLY|O_CLOEXEC) = -1 ENOENT
"/root/.cache/fontconfig/da43223dd54fb3bb4243ae19d4b583b2-le64.cache-11", O_RDONLY|O_CLOEXEC) = -1 ENOENT
"/root/.cache/fontconfig/da82082e1ef13c4097208324d67c180c-le64.cache-11", O_RDONLY|O_CLOEXEC) = -1 ENOENT
"/root/.fontconfig/0bd3dc0958fa2205aaaa8ebb13e2872b-le64.cache-11", O_RDONLY|O_CLOEXEC) = -1 ENOENT
"/root/.fontconfig/111149350c6eff283e78acef98e70f62-le64.cache-11", O_RDONLY|O_CLOEXEC) = -1 ENOENT
"/root/.fontconfig/3047814df9a2f067bd2d96a2b9c36e5a-le64.cache-11", O_RDONLY|O_CLOEXEC) = -1 ENOENT
"/root/.fontconfig/3830d5c3ddfd5cd38a049b759396e72e-le64.cache-11", O_RDONLY|O_CLOEXEC) = -1 ENOENT
"/root/.fontconfig/4c599c202bc5c08e2d34565a40eac3b2-le64.cache-11", O_RDONLY|O_CLOEXEC) = -1 ENOENT
"/root/.fontconfig/4d6aee6d44eccb37054d3216e945f618-le64.cache-11", O_RDONLY|O_CLOEXEC) = -1 ENOENT
"/root/.fontconfig/573ec803664ed168555e0e8b6d0f0c7f-le64.cache-11", O_RDONLY|O_CLOEXEC) = -1 ENOENT
"/root/.fontconfig/6333f38776742d18e214673cd2c24e34-le64.cache-11", O_RDONLY|O_CLOEXEC) = -1 ENOENT
"/root/.fontconfig/99e8ed0e538f840c565b6ed5dad60d56-le64.cache-11", O_RDONLY|O_CLOEXEC) = -1 ENOENT
"/root/.fontconfig/9f5be04c82fedbbce398861326c6c8e3-le64.cache-11", O_RDONLY|O_CLOEXEC) = -1 ENOENT
"/root/.fontconfig/bb9ef35e7661cc55c3d6e0d2d8cc2051-le64.cache-11", O_RDONLY|O_CLOEXEC) = -1 ENOENT
"/root/.fontconfig/c855463f699352c367813e37f3f70ea7-le64.cache-11", O_RDONLY|O_CLOEXEC) = -1 ENOENT
"/root/.fontconfig/d52a8644073d54c13679302ca1180695-le64.cache-11", O_RDONLY|O_CLOEXEC) = -1 ENOENT
"/root/.fontconfig/d589a48862398ed80a3d6066f4f56f4c-le64.cache-11", O_RDONLY|O_CLOEXEC) = -1 ENOENT
"/root/.fontconfig/da43223dd54fb3bb4243ae19d4b583b2-le64.cache-11", O_RDONLY|O_CLOEXEC) = -1 ENOENT
"/root/.fontconfig/da82082e1ef13c4097208324d67c180c-le64.cache-11", O_RDONLY|O_CLOEXEC) = -1 ENOENT
```

### every CJK font open (first 20)
```
```

### font-path failures (first 40)
```
3650  openat(AT_FDCWD, "/usr/local/share/fonts/.uuid", O_RDONLY|O_CLOEXEC) = -1 ENOENT (No such file or directory)
3650  openat(AT_FDCWD, "/usr/local/share/fonts/.uuid", O_RDONLY|O_CLOEXEC) = -1 ENOENT (No such file or directory)
3650  openat(AT_FDCWD, "/usr/share/fonts/.uuid", O_RDONLY|O_CLOEXEC) = -1 ENOENT (No such file or directory)
3650  openat(AT_FDCWD, "/usr/share/fonts/.uuid", O_RDONLY|O_CLOEXEC) = -1 ENOENT (No such file or directory)
3650  openat(AT_FDCWD, "/usr/share/fonts/X11/.uuid", O_RDONLY|O_CLOEXEC) = -1 ENOENT (No such file or directory)
3650  openat(AT_FDCWD, "/usr/share/fonts/X11/.uuid", O_RDONLY|O_CLOEXEC) = -1 ENOENT (No such file or directory)
3650  openat(AT_FDCWD, "/usr/share/fonts/opentype/.uuid", O_RDONLY|O_CLOEXEC) = -1 ENOENT (No such file or directory)
3650  openat(AT_FDCWD, "/usr/share/fonts/opentype/.uuid", O_RDONLY|O_CLOEXEC) = -1 ENOENT (No such file or directory)
3650  openat(AT_FDCWD, "/usr/share/fonts/X11/Type1/.uuid", O_RDONLY|O_CLOEXEC) = -1 ENOENT (No such file or directory)
3650  openat(AT_FDCWD, "/usr/share/fonts/X11/cyrillic/.uuid", O_RDONLY|O_CLOEXEC) = -1 ENOENT (No such file or directory)
3650  openat(AT_FDCWD, "/usr/share/fonts/X11/cyrillic/.uuid", O_RDONLY|O_CLOEXEC) = -1 ENOENT (No such file or directory)
3650  openat(AT_FDCWD, "/usr/share/fonts/X11/encodings/.uuid", O_RDONLY|O_CLOEXEC) = -1 ENOENT (No such file or directory)
3650  openat(AT_FDCWD, "/usr/share/fonts/opentype/ipafont-gothic/.uuid", O_RDONLY|O_CLOEXEC) = -1 ENOENT (No such file or directory)
3650  openat(AT_FDCWD, "/usr/share/fonts/opentype/tlwg/.uuid", O_RDONLY|O_CLOEXEC) = -1 ENOENT (No such file or directory)
3650  openat(AT_FDCWD, "/usr/share/fonts/opentype/tlwg/.uuid", O_RDONLY|O_CLOEXEC) = -1 ENOENT (No such file or directory)
3650  openat(AT_FDCWD, "/usr/share/fonts/opentype/unifont/.uuid", O_RDONLY|O_CLOEXEC) = -1 ENOENT (No such file or directory)
3650  openat(AT_FDCWD, "/usr/share/fonts/truetype/crosextra/.uuid", O_RDONLY|O_CLOEXEC) = -1 ENOENT (No such file or directory)
3650  openat(AT_FDCWD, "/usr/share/fonts/truetype/dejavu/.uuid", O_RDONLY|O_CLOEXEC) = -1 ENOENT (No such file or directory)
3650  openat(AT_FDCWD, "/usr/share/fonts/truetype/dejavu/.uuid", O_RDONLY|O_CLOEXEC) = -1 ENOENT (No such file or directory)
3650  openat(AT_FDCWD, "/usr/share/fonts/truetype/freefont/.uuid", O_RDONLY|O_CLOEXEC) = -1 ENOENT (No such file or directory)
3650  openat(AT_FDCWD, "/usr/share/fonts/truetype/jetbrains-mono/.uuid", O_RDONLY|O_CLOEXEC) = -1 ENOENT (No such file or directory)
3650  openat(AT_FDCWD, "/usr/share/fonts/truetype/jetbrains-mono/.uuid", O_RDONLY|O_CLOEXEC) = -1 ENOENT (No such file or directory)
3650  openat(AT_FDCWD, "/usr/share/fonts/truetype/liberation/.uuid", O_RDONLY|O_CLOEXEC) = -1 ENOENT (No such file or directory)
3650  openat(AT_FDCWD, "/usr/share/fonts/truetype/liberation/.uuid", O_RDONLY|O_CLOEXEC) = -1 ENOENT (No such file or directory)
3650  openat(AT_FDCWD, "/usr/share/fonts/truetype/libreoffice/.uuid", O_RDONLY|O_CLOEXEC) = -1 ENOENT (No such file or directory)
3650  openat(AT_FDCWD, "/usr/share/fonts/truetype/libreoffice/.uuid", O_RDONLY|O_CLOEXEC) = -1 ENOENT (No such file or directory)
3650  openat(AT_FDCWD, "/usr/share/fonts/truetype/noto/.uuid", O_RDONLY|O_CLOEXEC) = -1 ENOENT (No such file or directory)
3650  openat(AT_FDCWD, "/usr/share/fonts/truetype/noto/.uuid", O_RDONLY|O_CLOEXEC) = -1 ENOENT (No such file or directory)
3650  openat(AT_FDCWD, "/usr/share/fonts/truetype/wqy/.uuid", O_RDONLY|O_CLOEXEC) = -1 ENOENT (No such file or directory)
3650  openat(AT_FDCWD, "/usr/share/fonts/truetype/wqy/.uuid", O_RDONLY|O_CLOEXEC) = -1 ENOENT (No such file or directory)
3650  openat(AT_FDCWD, "/usr/share/fonts/X11/encodings/large/.uuid", O_RDONLY|O_CLOEXEC) = -1 ENOENT (No such file or directory)
3650  openat(AT_FDCWD, "/usr/share/fonts/X11/encodings/large/.uuid", O_RDONLY|O_CLOEXEC) = -1 ENOENT (No such file or directory)
```

During the headful run, look at the window and the browser's own UI (tab title, menus). Note whether 帳 shows as a glyph or a box.
