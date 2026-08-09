import asyncio
import os

from render_sdk import RenderAsync


async def main():
    render = RenderAsync(token=os.environ["RENDER_API_KEY"])

    run = await render.workflows.start_task(
        "massagevip-ai-workflow/process_lead",
        [{
            "name": "Customer",
            "phone": "966XXXXXXXXX",
            "message": "Hi, I want to book a massage today",
            "source": "WhatsApp",
        }],
    )

    print("Started:", run.id)
    result = await run
    print(result.results)


if __name__ == "__main__":
    asyncio.run(main())
