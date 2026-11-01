import re
from datetime import datetime

from pydantic import (
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    field_validator,
    model_validator,
)


def validate_password_policy(pw: str) -> str:
    problems = []
    if len(pw) < 10:
        problems.append("at least 10 characters")
    if len(pw) > 128:
        problems.append("at most 128 characters")
    if not re.search(r"[a-z]", pw):
        problems.append("a lowercase letter")
    if not re.search(r"[A-Z]", pw):
        problems.append("an uppercase letter")
    if not re.search(r"\d", pw):
        problems.append("a digit")
    if problems:
        raise ValueError("Password must contain " + ", ".join(problems))
    return pw


class _Email(BaseModel):
    email: EmailStr

    @field_validator("email", mode="after")
    @classmethod
    def _norm(cls, v: str) -> str:
        return v.strip().lower()


class SignupRequest(_Email):
    full_name: str = Field(min_length=2, max_length=120)
    password: str
    password_confirm: str

    @field_validator("full_name")
    @classmethod
    def _name(cls, v: str) -> str:
        return " ".join(v.split())

    @field_validator("password")
    @classmethod
    def _pw(cls, v: str) -> str:
        return validate_password_policy(v)

    @model_validator(mode="after")
    def _match(self):
        if self.password != self.password_confirm:
            raise ValueError("Passwords do not match")
        return self


class LoginRequest(_Email):
    password: str = Field(min_length=1, max_length=128)


class ForgotPasswordRequest(_Email):
    pass


class ResetPasswordRequest(BaseModel):
    token: str = Field(min_length=20, max_length=200)
    password: str
    password_confirm: str

    @field_validator("password")
    @classmethod
    def _pw(cls, v: str) -> str:
        return validate_password_policy(v)

    @model_validator(mode="after")
    def _match(self):
        if self.password != self.password_confirm:
            raise ValueError("Passwords do not match")
        return self


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(max_length=128)
    new_password: str
    new_password_confirm: str

    @field_validator("new_password")
    @classmethod
    def _pw(cls, v: str) -> str:
        return validate_password_policy(v)

    @model_validator(mode="after")
    def _match(self):
        if self.new_password != self.new_password_confirm:
            raise ValueError("Passwords do not match")
        return self


class ProfileUpdate(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    email: str
    full_name: str
    email_verified: bool
    has_password: bool
    providers: list[str]
    created_at: datetime


class SessionOut(BaseModel):
    user: UserOut
    csrf_token: str


class AuthConfigOut(BaseModel):
    google_enabled: bool
    openai_enabled: bool
    email_delivery_enabled: bool
    environment: str


class MessageOut(BaseModel):
    message: str
    dev_reset_link: str | None = None
