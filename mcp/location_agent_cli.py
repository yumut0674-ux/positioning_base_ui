r"""Terminal-only Gemini client for the UWB read-only MCP server.
mcp\.venv\Scripts\python.exe -m uvicorn chat_api:app --app-dir mcp --host 127.0.0.1 --port 8000

mcp\.venv\Scripts\python.exe mcp\location_agent_cli.py

"""

from __future__ import annotations

import asyncio
import sys

from location_agent_runtime import (
    EXIT_COMMANDS,
    AgentProviderError,
    LocationAgentRuntime,
    configure_terminal_encoding,
)


async def run_terminal_chat() -> None:
    runtime = LocationAgentRuntime()
    await runtime.start()

    try:
        health = await runtime.health()
        session_id = await runtime.create_session()

        print("\nUWB Konum Analisti hazır.")
        print("Sağlayıcı: Google Gemini")
        print(f"Model: {health['model']}")
        print(f"Oturum: {session_id}")
        print(f"Konum araçları: {', '.join(health['tools'])}")
        print("Komutlar: /clear konuşmayı temizler, /exit programı kapatır.\n")

        while True:
            try:
                user_input = input("Sen > ").strip()
            except EOFError:
                print()
                break

            if not user_input:
                continue
            if user_input.casefold() in EXIT_COMMANDS:
                break
            if user_input.casefold() == "/clear":
                await runtime.clear_session(session_id)
                session_id = await runtime.create_session()
                print("AI  > Konuşma hafızası temizlendi.\n")
                continue

            try:
                result = await runtime.answer(user_input, session_id=session_id)
                session_id = result.session_id
                print(f"AI  > {result.answer}\n")
            except AgentProviderError as error:
                print(f"Hata> Sorgu tamamlanamadı: {error.public_message}\n", file=sys.stderr)

        print("UWB Konum Analisti kapatıldı.")
    finally:
        await runtime.shutdown()


def main() -> int:
    configure_terminal_encoding()
    try:
        asyncio.run(run_terminal_chat())
    except KeyboardInterrupt:
        print("\nUWB Konum Analisti kapatıldı.")
    except Exception as error:
        print(f"Hata: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
