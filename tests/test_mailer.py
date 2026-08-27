"""Tests for Amazon SES mailer."""

from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from src.mailer import send_email


class SendEmailTest(unittest.TestCase):
    @patch("src.mailer.boto3.client")
    @patch("src.mailer.get_settings")
    def test_skips_without_from(self, mock_settings, mock_client):
        settings = MagicMock()
        settings.ses_from_email = ""
        settings.aws_region = "us-east-1"
        mock_settings.return_value = settings

        self.assertFalse(
            send_email(to="agent@example.com", subject="Hi", text="Body")
        )
        mock_client.assert_not_called()

    @patch("src.mailer.boto3.client")
    @patch("src.mailer.get_settings")
    def test_posts_to_ses(self, mock_settings, mock_client):
        settings = MagicMock()
        settings.ses_from_email = "Relevium Tools - Time Clock <no_reply@releviumpain.com>"
        settings.aws_region = "us-east-1"
        mock_settings.return_value = settings
        client = MagicMock()
        mock_client.return_value = client

        self.assertTrue(
            send_email(
                to="agent@example.com",
                subject="Clock in",
                text="Please clock in",
                html="<p>Please clock in</p>",
            )
        )
        client.send_email.assert_called_once()
        kwargs = client.send_email.call_args.kwargs
        self.assertEqual(
            kwargs["Source"], "Relevium Tools - Time Clock <no_reply@releviumpain.com>"
        )
        self.assertEqual(kwargs["Destination"]["ToAddresses"], ["agent@example.com"])
        self.assertEqual(kwargs["Message"]["Subject"]["Data"], "Clock in")
        self.assertEqual(
            kwargs["Message"]["Body"]["Html"]["Data"], "<p>Please clock in</p>"
        )
