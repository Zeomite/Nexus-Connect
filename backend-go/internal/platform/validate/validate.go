package validate

import (
	"fmt"
	"regexp"
	"sync"

	apperrors "nexus-connect/backend-go/internal/platform/errors"

	"github.com/go-playground/validator/v10"
)

var (
	once     sync.Once
	instance *validator.Validate

	hasUpper   = regexp.MustCompile(`[A-Z]`)
	hasLower   = regexp.MustCompile(`[a-z]`)
	hasDigit   = regexp.MustCompile(`[0-9]`)
	hasSpecial = regexp.MustCompile(`[!@#$%^&*(),.?":{}|<>]`)
)

func get() *validator.Validate {
	once.Do(func() {
		instance = validator.New()
		_ = instance.RegisterValidation("password_strength", passwordStrength)
	})
	return instance
}

// passwordStrength mirrors the character-class checks in validators.ts's
// PasswordStrengthSchema: at least one upper, lower, digit, and special
// character. The schema's length bound (8-128) is its own separate
// .min()/.max() chain in the TS source, not folded into the character-class
// .refine() calls — so here too, length is expressed via the standard
// "min=8,max=128" validator tags alongside this one, not duplicated here.
func passwordStrength(fl validator.FieldLevel) bool {
	v := fl.Field().String()
	return hasUpper.MatchString(v) && hasLower.MatchString(v) &&
		hasDigit.MatchString(v) && hasSpecial.MatchString(v)
}

// Struct validates v and, on failure, returns an *apperrors.AppError with
// Code "VALIDATION_ERROR" and Details keyed by field name — mirroring
// validate()/safeValidate() in validators.ts.
func Struct(v any) error {
	err := get().Struct(v)
	if err == nil {
		return nil
	}

	validationErrs, ok := err.(validator.ValidationErrors)
	if !ok {
		return apperrors.Validation("Validation failed", nil)
	}

	// fe.Field() is the leaf field name only (e.g. "Street", not
	// "Address.Street"), unlike the TS original's err.path.join('.') full
	// path — fine for today's flat request structs, but two same-named
	// fields in different nested sub-structs would collide in this map.
	// Switch to fe.Namespace() (minus its leading root-type segment) if a
	// future request DTO actually nests structs.
	details := make(map[string]any, len(validationErrs))
	for _, fe := range validationErrs {
		details[fe.Field()] = fmt.Sprintf("failed on the '%s' rule", fe.Tag())
	}

	return apperrors.Validation("Validation failed", details)
}
