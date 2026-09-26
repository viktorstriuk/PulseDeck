# PulseDeck.GameOverlayHost 2.8.0

Новый, полностью собираемый Windows x64 помощник. Создан на основе справочного
кода владельца проекта и восстановленного контракта поставляемого бинарника 2.5.0
(этот же EXE использовался до 2.6.4). Это НЕ утверждение о наличии точного
исходника старого бинарного файла.

Старый SHA-256: `dea5d7ca9dcdaf641eb884b805c02b8760d574c3dfa8014a9b5a2716b3716115`.
Справочный старый файл лежит отдельно в `../docs/history/native-reference`, не компилируется и
не встраивается в приложение. Текущий бинарник строится только из этой папки.

## Изменение 2.6.9

Человекочитаемый `status.reason` заменён на стабильный `status.reasonKey`.
Подпись переводится родительским приложением из `app/languages/*.json`;
названия игр, процессов и музыки не переводятся. В 2.8.0 этот EXE пересобирается из исходников при каждой сборке установщика.
Старый готовый EXE не требуется на входе.

## Контракт

stdin/stdout — JSON Lines UTF-8. На старте: hello с версией, PID и backends.
Вход: bind, config, state, visual, audio, stop; probe не меняет настройки, следующий
периодический status служит ответом. Максимум входной строки — 1 МиБ. Обновления
не очередятся неограниченно, а заменяют текущий снимок. EOF закрывает помощник.
Состояния foreground/candidates, renderer, rtss соответствуют существующему UI.

`enumerator.go`: один callback через sync.Once, живые Go-контексты по токену,
синхронный EnumWindows и очистка map через defer. Регистрация не зависит от числа
треков, окон, опросов или переключений конфигурации.

`platform_windows.go`: обычные Win32 API для окон, mutex, общая память RTSS.
Ни DLL-инъекций, ни чтения внутренней памяти игр, ни обхода античита нет.
`rtss.go`: проверка заголовка/размеров, собственник `PulseDeck.GameOverlay`,
слоты с индекса 1, старый текст 256 байт и расширенный 4096 байт, версия протокола
2.x, атомарный dwBusy bit 0 и счётчик OSDFrame, очистка только собственных слотов.
`osd.go`: компактный текст/палитра/прогресс/спектр; для протокола до 2.11 — простой
текст без неподдерживаемых управляющих тегов.

Один процесс владеет ресурсами до завершения runHost. Даже при ошибке stdout
освобождаются ресурсы; os.Exit используется только после возврата из runHost.
Зависший внешней программой dwBusy не заставляет этот процесс молчать: статусы
продолжаются, а записи ждут свободного слота без занятого цикла ожидания.

## Источники интерфейсов

- Go 1.23.2 runtime: https://go.googlesource.com/go/+/refs/tags/go1.23.2/src/runtime/syscall_windows.go
- syscall.NewCallback: https://go.dev/src/syscall/syscall_windows.go
- EnumWindows: https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-enumwindows
- VirtualQuery: https://learn.microsoft.com/en-us/windows/win32/api/memoryapi/nf-memoryapi-virtualquery
- SetWindowPos: https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowpos
- Интерфейс RTSSSharedMemory.h (опубликованная копия SDK): https://raw.githubusercontent.com/RecursiveLife/RTSS_Crosshair/master/RTSS_Crosshair_v2/RTSS_Crosshair/RTSSSharedMemory.h

Поля/пороговые версии дополнительно сверены по машинному коду старого помощника:
openRTSS, findSlot, updateText, release, appForPID, buildRTSSOSD. Сторонний SDK не
добавлен как зависимость и его реализация в проект не копировалась.

## Сборка

```sh
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -H=windowsgui" -o ../app/assets/native/PulseDeck.GameOverlayHost.exe .
```

Для текущей сборки использован установленный Go 1.23.2. SHA и проверка повторной
сборки находятся в ../test-results/2.8.0/. GUI subsystem скрывает
отдельную консоль; наследуемые stdin/stdout/stderr используются через Electron.

Linux-тесты проверяют общий код, заменяя системные вызовы Win32 и сервер RTSS.
`platform_windows_test.go` можно исполнить только на Windows; в этой среде выполнена
лишь его кросс-компиляция. Реальные RTSS/игры, DPI/мониторы и нативные HANDLE требуют
проверки в Windows. Независимого аудита или доверенной подписи у EXE нет.
