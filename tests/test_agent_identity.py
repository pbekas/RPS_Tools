from __future__ import annotations

import unittest

from src.agent_identity import (
    is_mapped_agent_user,
    match_mapped_agent,
    names_match_confident,
)


class AgentIdentityTest(unittest.TestCase):
    def test_mapped_agent_requires_real_directory_user(self) -> None:
        self.assertTrue(
            is_mapped_agent_user(
                {
                    "email": "diana.lopez@releviumpain.com",
                    "name": "Diana Lopez",
                    "role": "Agent",
                    "provisional": False,
                    "active": True,
                }
            )
        )
        self.assertFalse(
            is_mapped_agent_user(
                {
                    "email": "jane.doe@releviumpain.com",
                    "name": "Jane Doe",
                    "role": "Agent",
                    "provisional": True,
                }
            )
        )
        self.assertFalse(
            is_mapped_agent_user(
                {
                    "email": "unmapped.jane@releviumpain.com",
                    "name": "Jane",
                    "role": "Agent",
                }
            )
        )
        self.assertFalse(
            is_mapped_agent_user(
                {
                    "email": "pete@releviumpain.com",
                    "name": "Pete",
                    "role": "Admin",
                }
            )
        )

    def test_confident_match_needs_first_and_last(self) -> None:
        self.assertTrue(names_match_confident("Diana Lopez", "Diana Lopez"))
        self.assertTrue(names_match_confident("diana lopez", "Diana M Lopez"))
        self.assertFalse(names_match_confident("Diana", "Diana Lopez"))
        self.assertFalse(names_match_confident("Maria", "Maria Garcia"))

    def test_unmatched_or_first_name_only_stays_unassigned(self) -> None:
        users = [
            {
                "email": "diana.lopez@releviumpain.com",
                "name": "Diana Lopez",
                "role": "Agent",
                "provisional": False,
                "active": True,
            }
        ]
        email, name = match_mapped_agent("Maria Gonzalez", users)
        self.assertIsNone(email)
        self.assertEqual(name, "Maria Gonzalez")

        email, name = match_mapped_agent("Diana", users)
        self.assertIsNone(email)
        self.assertEqual(name, "Diana")

        email, name = match_mapped_agent("Diana Lopez", users)
        self.assertEqual(email, "diana.lopez@releviumpain.com")
        self.assertEqual(name, "Diana Lopez")


if __name__ == "__main__":
    unittest.main()
