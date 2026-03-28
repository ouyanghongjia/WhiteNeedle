# Resign tool

Place **WhiteNeedle.dylib** in `payload/` before running (copy from `../ios-dylib/build/` after `make`).

```bash
cp ../ios-dylib/build/WhiteNeedle.dylib payload/
./resign.sh -i Your.ipa -c "Apple Development: …" -p /path/to.mobileprovision
```

See `resign.sh -h` for options.
