@echo off
title Asistente de Instalacion de Impresora Termica - Precios al Dia
echo ==============================================================
echo    PRECIOS AL DIA - INSTALADOR DE IMPRESORA TERMICA POS
echo    Driver: POS Printer Driver V7.17
echo ==============================================================
echo Instalando controladores en segundo plano...
echo.
"%~dp0Instalador_Impresora_POS.exe" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART
if %ERRORLEVEL% EQU 0 (
    echo.
    echo [EXITO] Driver instalado correctamente.
    echo Conecte su impresora USB y seleccione POS-58 o POS-80 en el instalador.
) else (
    echo.
    echo [AVISO] Iniciando instalador interactivo...
    "%~dp0Instalador_Impresora_POS.exe"
)
pause
