import { IsNotEmpty, IsString, Length } from 'class-validator';

export class CreateCheckoutProDto {
  @IsString()
  @IsNotEmpty()
  @Length(1, 100)
  planoId!: string;
}
